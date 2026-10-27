/**
 * The agent driver: owns the single Agent the TUI drives and feeds the
 * {@link TranscriptModel} from the runtime's live surfaces. Mirrors the
 * recorder/headless drive loop (create or resume → subscribe → followup →
 * whenIdle) but stays resident for the interactive session.
 *
 * **Lazy sessions**: with `lazy: true` (and no `--resume`), no Agent/Session
 * is created at boot — only the first submitted message materializes one, so
 * quitting without typing leaves no empty session behind. A model switch made
 * before the first message is applied at creation time.
 * @module dsh-tui/agent-driver
 */

import { randomUUID } from 'node:crypto'
import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-fs'
import { createUserMessage, MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { AssistantStreamFrameLike, ToolPresenter, TranscriptModel } from './events.ts'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { t } from './i18n.ts'

/** Route override from the command line; absent keeps the profile default. */
export interface DriverModelRoute {
  provider: string
  model: string
}

/** A model selection applied to the next step. */
export interface ModelSwitch {
  provider: string
  model: string
  reasoningEffort: string | undefined
}

export interface DriverOptions {
  /** Persisted session id to resume; absent creates a fresh session. */
  resume: string | undefined
  /** Explicit model route; absent keeps the default selection. */
  model: DriverModelRoute | undefined
  /** Agent preset mode id; applied to freshly created sessions. */
  preset: string | undefined
  /** Defer session/agent creation until the first send (no idle junk sessions). */
  lazy?: boolean
}

export interface AgentDriver {
  /** The live Agent handle; undefined while the session is still lazy. */
  readonly agent: Agent | undefined
  /** The driven session; undefined while the session is still lazy. */
  get session(): Session | undefined
  /** Whether an Agent exists (false in lazy pre-first-message state). */
  get hasAgent(): boolean
  readonly model: TranscriptModel
  /** Current live status of the whole agent. */
  readonly running: boolean
  /** Current selection route, live. */
  get route(): { provider: string, model: string }
  /** Submit one user turn (creates the session on first use; queues while running). */
  send(text: string): Promise<void>
  /** Submit one steering message for the next step of the running turn. */
  steer(text: string): Promise<void>
  /** Switch the model for the next step. */
  setModel(switchTo: ModelSwitch): void
  /** Effective working directory. */
  workingDirectory(): string
  /** Change the working directory (durable). */
  setWorkingDirectory(path: string): Promise<string>
  /** Snapshot of pending inbox input (steering first, queued turns after). */
  inbox(): readonly { target: 'next-step' | 'next-turn', id: string, text: string }[]
  /** Remove one pending inbox message. */
  removeInboxMessage(id: string): boolean
  /** Fork the current session; resolves to the child session id. */
  forkCurrent(): Promise<string>
  /** Interrupt the running turn, keeping queued input. */
  cancel(): void
  /** Observe running/idle flips (fires on every change; returns its disposer). */
  onStatus(listener: (running: boolean) => void): () => void
  /** Stop feeding the model; resolves after subscriptions are dropped. */
  stop(): void
  /** Stop feeding and retire the agent entirely (session switch). */
  dispose(): Promise<void>
  /** Flush the durable session log. */
  flush(): Promise<void>
}

/**
 * Builds the fold's {@link ToolPresenter} over the live tool registry. Both
 * present methods are pure functions of (args, durable result), so views are
 * identical live and on replay.
 */
export function createToolPresenter(ctx: Context): ToolPresenter {
  return {
    callView(name: string, rawArgs: string): ToolCallView | undefined {
      try {
        const tool = ctx.get('tools')?.get(name)
        if (tool?.presentCall === undefined) return undefined
        return tool.presentCall(JSON.parse(rawArgs) as unknown)
      } catch {
        return undefined
      }
    },
    resultView(name: string, rawArgs: string, result: { content: unknown, isError: boolean, meta?: unknown }): ToolResultView | undefined {
      try {
        const tool = ctx.get('tools')?.get(name)
        if (tool?.presentResult === undefined) return undefined
        return tool.presentResult(JSON.parse(rawArgs) as unknown, result as never)
      } catch {
        return undefined
      }
    },
  }
}

/**
 * Create the driver. With `lazy: true` (and no resume id) no Agent/Session is
 * created until the first `send()`; `resume` always materializes immediately
 * (the user explicitly chose a session, and its history replays).
 */
export async function createDriver(
  ctx: Context,
  model: TranscriptModel,
  options: DriverOptions,
): Promise<AgentDriver> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error('tui: core services (agents, agentDefaultModel, sessions) are unavailable')
  }

  const profileSelection = defaultModel.currentSelection()
  let selection: { provider: string, model: string, reasoningEffort?: string | undefined } = {
    provider: profileSelection.provider,
    model: profileSelection.model,
    reasoningEffort: profileSelection.reasoningEffort,
  }
  if (options.model !== undefined) selection = { ...selection, ...options.model }
  const agentOptions = () => ({ provider: selection.provider, model: selection.model })

  const fs = ctx.get('fs')
  const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
  const statusListeners: Array<(running: boolean) => void> = []

  let selectionRef: ModelSelectionRef | undefined
  let handle: { agent: Agent, dispose(): Promise<void> } | undefined
  let agent: Agent | undefined
  let running = false
  let firstSeqAtWire = 0

  const stoppers: Array<() => void> = []
  const wireAgent = (wired: Agent): void => {
    const safeApply = (label: string, action: () => void): void => {
      try {
        action()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          model.pushNotice(t('transcript.uiError', { label, message: message.slice(0, 120) }), 'error')
        } catch {
          // Last resort: swallow to keep the process alive.
        }
      }
    }
    stoppers.push(
      ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === wired) {
          running = status === 'running'
          for (const callback of statusListeners) callback(running)
        }
      }),
      ctx.on('agent/error', ({ agent: subject, error }) => {
        if (subject === wired) {
          const message = error instanceof Error ? error.message : String(error)
          model.pushNotice(t('notice.agentError', { message: message.slice(0, 180) }), 'error')
        }
      }),      ctx.on('session/event', (session, event) => {
        if (session === wired.session) safeApply('event', () => model.applyEvent(event))
      }),
      ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
        if (subject === wired) safeApply('stream', () => model.applyFrame(frame as AssistantStreamFrameLike))
      }),
    )
  }

  /** Materialize the lazy agent (once). Resumes when a resume id was given. */
  const ensureAgent = async (): Promise<Agent> => {
    if (agent !== undefined) return agent
    const opts = agentOptions()
    const setup = (agentCtx: Context): void => {
      const selected: ModelSelectionRef = {
        current: {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }),
        },
        assembled: undefined,
      }
      selectionRef = selected
      installModelSelection(agentCtx, selected)
    }
    if (options.resume === undefined) {
      const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
      const meta: { cwd: string; agentPreset?: string } = { cwd }
      if (options.preset !== undefined) meta.agentPreset = options.preset
      handle = await agents.create({ sessionId, meta: meta as never, agentOptions: agentOptions(), setup })
    } else {
      if (ctx.get('sessionPersistence') === undefined) {
        throw new Error('tui --resume requires the sessionPersistence service; dsh-base provides it')
      }
      const resumeSessionId = brandString<SessionId>(options.resume)
      try {
        handle = await agents.resume({ resumeSessionId, agentOptions: agentOptions(), setup })
      } catch (error: unknown) {
        throw new Error(`tui: cannot resume session "${options.resume}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    agent = handle.agent
    wireAgent(agent)
    await agent.whenIdle()
    if (options.resume !== undefined) {
      // Replay the resumed history through the same fold before subscribing
      // (eventAt is the existing history read; projection migration deferred).
      const length = agent.session.seq
      for (let seq = 0; seq < length; seq++) {
        const event = agent.session.eventAt(SessionSeq(seq))
        if (event !== undefined) model.applyEvent(event as SessionEvent)
      }
    }
    return agent
  }

  if (options.resume !== undefined) await ensureAgent()

  const requireAgent = (): Agent => {
    if (agent === undefined) throw new Error(t('notice.needFirstMessage'))
    return agent
  }

  return {
    get agent(): Agent | undefined {
      return agent
    },
    get session(): Session | undefined {
      return agent?.session
    },
    get hasAgent(): boolean {
      return agent !== undefined
    },
    model,
    get running(): boolean {
      return running
    },
    get route(): { provider: string, model: string } {
      const current = selectionRef?.current
      return current === undefined
        ? { provider: selection.provider, model: selection.model }
        : { provider: current.provider, model: current.model }
    },
    async send(text: string): Promise<void> {
      const wired = await ensureAgent()
      wired.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    async steer(text: string): Promise<void> {
      const wired = await ensureAgent()
      wired.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    setModel(switchTo: ModelSwitch): void {
      selection = {
        provider: switchTo.provider,
        model: switchTo.model,
        reasoningEffort: switchTo.reasoningEffort,
      }
      if (selectionRef !== undefined) {
        selectionRef.current = {
          provider: switchTo.provider,
          model: switchTo.model,
          ...(switchTo.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(switchTo.reasoningEffort) }),
        }
      }
    },
    workingDirectory(): string {
      const service = ctx.get('workingDirectory')
      if (agent !== undefined && service !== undefined) return service.get(agent.session)
      return cwd
    },
    async setWorkingDirectory(path: string): Promise<string> {
      const wired = await ensureAgent()
      const service = ctx.get('workingDirectory')
      if (service === undefined) throw new Error('tui: workingDirectory service unavailable')
      return await service.set(wired, path)
    },
    inbox(): readonly { target: 'next-step' | 'next-turn', id: string, text: string }[] {
      if (agent === undefined) return []
      const extract = (messages: readonly UserMessage[], target: 'next-step' | 'next-turn') =>
        messages.map(message => ({
          target,
          id: String(message.id),
          text: message.content
            .filter(block => block.type === 'text')
            .map(block => (block.type === 'text' ? block.text : ''))
            .join(''),
        }))
      const inbox = agent.inbox
      return [...extract(inbox.nextStep, 'next-step'), ...extract(inbox.nextTurn, 'next-turn')]
    },
    removeInboxMessage(id: string): boolean {
      return agent?.inbox.remove(MessageId(id)) ?? false
    },
    async forkCurrent(): Promise<string> {
      const wired = await ensureAgent()
      const child = ctx.get('sessions')?.fork(wired.session)
      if (child === undefined) throw new Error('tui: session fork unavailable')
      await ctx.get('sessions')?.flush(child)
      return String(child.id)
    },
    cancel(): void {
      agent?.cancel({ kind: 'user' }, { keepInbox: true })
    },
    /** Observe running/idle flips (fires on every change; returns its disposer). */
    onStatus(listener: (running: boolean) => void): () => void {
      statusListeners.push(listener)
      // Late subscribers get the current state immediately.
      listener(running)
      return () => {
        const index = statusListeners.indexOf(listener)
        if (index >= 0) statusListeners.splice(index, 1)
      }
    },
    stop(): void {
      for (const stop of stoppers.splice(0)) stop()
    },
    async dispose(): Promise<void> {
      stoppers.splice(0).forEach(stop => stop())
      if (handle !== undefined) await handle.dispose()
      agent = undefined
      handle = undefined
    },
    async flush(): Promise<void> {
      if (agent === undefined) return
      await sessions.flush(agent.session)
    },
  }
}
