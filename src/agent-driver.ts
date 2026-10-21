/**
 * The agent driver: owns the single Agent the TUI drives and feeds the
 * {@link TranscriptModel} from the runtime's live surfaces. Mirrors the
 * recorder/headless drive loop (create or resume → subscribe → followup →
 * whenIdle) but stays resident for the interactive session.
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
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { AssistantStreamFrameLike, TranscriptModel } from './events.ts'

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
}

export interface AgentDriver {
  /** The live Agent handle (command execution needs it). */
  readonly agent: Agent
  readonly session: Agent['session']
  readonly model: TranscriptModel
  /** Current live status of the whole agent. */
  readonly running: boolean
  /** Enqueue one user turn (queues into the inbox while a turn runs). */
  send(text: string): void
  /** Submit one steering message for the next step of the running turn. */
  steer(text: string): void
  /** Current model selection route, live. */
  get route(): { provider: string, model: string }
  /** Switch the model for the next step. */
  setModel(switchTo: ModelSwitch): void
  /** Effective working directory. */
  workingDirectory(): string
  /** Change the working directory (durable). */
  setWorkingDirectory(path: string): Promise<string>
  /** Interrupt the running turn, keeping queued input. */
  cancel(): void
  /** Stop feeding the model; resolves after subscriptions are dropped. */
  stop(): void
  /** Stop feeding and retire the agent entirely (session switch). */
  dispose(): Promise<void>
  /** Flush the durable session log. */
  flush(): Promise<void>
}

/**
 * Create (or resume) the driven agent and wire its events into `model`.
 * @param ctx - plugin context carrying the core services.
 * @param model - the fold receiving events and frames.
 * @param options - resume identity and route override.
 * @returns the resident driver.
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

  const selection = defaultModel.currentSelection()
  const route = options.model === undefined
    ? { provider: selection.provider, model: selection.model }
    : options.model
  const agentOptions = { provider: route.provider, model: route.model }
  let selectionRef: ModelSelectionRef | undefined
  const setup = (agentCtx: Context): void => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    selectionRef = selected
    installModelSelection(agentCtx, selected)
  }

  const fs = ctx.get('fs')
  const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))

  let agent: Agent
  let handle: { agent: Agent, dispose(): Promise<void> }
  if (options.resume === undefined) {
    const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
    handle = await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
    agent = handle.agent
  } else {
    if (ctx.get('sessionPersistence') === undefined) {
      throw new Error('tui --resume requires the sessionPersistence service; dsh-base provides it')
    }
    const resumeSessionId = brandString<SessionId>(options.resume)
    try {
      handle = await agents.resume({ resumeSessionId, agentOptions, setup })
      agent = handle.agent
    } catch (error: unknown) {
      throw new Error(`tui: cannot resume session "${options.resume}": ${error instanceof Error ? error.message : String(error)}`)
    }
    // Replay the resumed history through the same fold before subscribing,
    // so the transcript shows the whole conversation. (eventAt is the
    // existing history read; the projection seam migration is deferred.)
    const length = agent.session.seq
    for (let seq = 0; seq < length; seq++) {
      const event = agent.session.eventAt(SessionSeq(seq))
      if (event !== undefined) model.applyEvent(event as SessionEvent)
    }
  }
  await agent.whenIdle()

  let running = agent.status === 'running'
  // Exceptions inside Cordis event listeners are fatal to the process;
  // degrade to a transcript notice instead.
  const safeApply = (label: string, action: () => void): void => {
    try {
      action()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        model.pushNotice(`· ui error (${label}): ${message.slice(0, 120)}`, 'error')
      } catch {
        // Last resort: swallow to keep the process alive.
      }
    }
  }
  const stopStatus = ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject === agent) running = status === 'running'
  })
  const stopErrors = ctx.on('agent/error', ({ agent: subject, error }) => {
    if (subject === agent) {
      const message = error instanceof Error ? error.message : String(error)
      model.pushNotice(`· error: ${message.slice(0, 180)}`, 'error')
    }
  })
  const stopEvents = ctx.on('session/event', (session, event) => {
    if (session === agent.session) safeApply('event', () => model.applyEvent(event))
  })
  const stopStream = ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
    if (subject === agent) safeApply('stream', () => model.applyFrame(frame as AssistantStreamFrameLike))
  })

  return {
    agent,
    session: agent.session,
    model,
    get running(): boolean {
      return running
    },
    send(text: string): void {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    steer(text: string): void {
      agent.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    /** Current selection route, live. */
    get route(): { provider: string, model: string } {
      const current = selectionRef?.current
      return current === undefined ? route : { provider: current.provider, model: current.model }
    },
    /** Switch the model for the next step (hot; durable event follows). */
    setModel(switchTo: ModelSwitch): void {
      if (selectionRef === undefined) {
        throw new Error('tui: model selection reference unavailable')
      }
      selectionRef.current = {
        provider: switchTo.provider,
        model: switchTo.model,
        ...(switchTo.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(switchTo.reasoningEffort) }),
      }
    },
    /** Effective working directory (session-scoped, durable on change). */
    workingDirectory(): string {
      return ctx.get('workingDirectory')?.get(agent.session) ?? cwd
    },
    async setWorkingDirectory(path: string): Promise<string> {
      const service = ctx.get('workingDirectory')
      if (service === undefined) throw new Error('tui: workingDirectory service unavailable')
      return await service.set(agent, path)
    },
    cancel(): void {
      agent.cancel({ kind: 'user' }, { keepInbox: true })
    },
    stop(): void {
      stopEvents()
      stopStream()
      stopStatus()
      stopErrors()
    },
    /** Stop feeding and retire the agent entirely (session switch). */
    async dispose(): Promise<void> {
      stopEvents()
      stopStream()
      stopStatus()
      stopErrors()
      await handle.dispose()
    },
    async flush(): Promise<void> {
      await sessions.flush(agent.session)
    },
  }
}
