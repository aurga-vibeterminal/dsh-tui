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
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
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

/**
 * What a dialog is waiting on the user for, mirroring the OSC 7501 program
 * status `blocked` kinds so the terminal can tell "working" from "waiting".
 */
export type BlockedKind = 'permission' | 'question'

/**
 * The state a terminal observer needs, aggregated from every busy source the
 * agent's own `agent/status` cannot see:
 *
 * - `running` — the driven agent's turn-level status (`idle` ⇄ `running`).
 * - `busy` — a turn, a maintenance task (compaction, whose public status stays
 *   `idle`), an in-flight LLM request, or a live background subagent.
 * - `blocked` — a dialog is waiting on the user inside that work.
 *
 * The delegation tool returns immediately, so a parent settles to `idle` while
 * its children keep running; `running` alone under-reports work.
 */
export interface DriverStatus {
  readonly running: boolean
  readonly busy: boolean
  readonly blocked: BlockedKind | undefined
  /** Whether a maintenance task (compaction) holds the agent out of the idle phase. */
  readonly maintenance: boolean
  /** LLM attempts currently streaming. */
  readonly attempts: number
  /** Live background subagent activations. */
  readonly subagents: number
}

/**
 * Combine the busy sources into the aggregate. Pure and exported so the
 * surprising cases (settled parent with live children, maintenance compaction,
 * an in-flight request) are testable without a cordis context. The individual
 * counts travel along: a client that is told `busy` can ask *why*.
 */
export function aggregateStatus(flags: {
  running: boolean
  maintenance: boolean
  attempts: number
  subagents: number
  blocked: BlockedKind | undefined
}): DriverStatus {
  return {
    running: flags.running,
    busy: flags.running || flags.maintenance || flags.attempts > 0 || flags.subagents > 0,
    blocked: flags.blocked,
    maintenance: flags.maintenance,
    attempts: flags.attempts,
    subagents: flags.subagents,
  }
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
  /** Whether any work is in flight: turn, maintenance, LLM request, or subagent. */
  readonly busy: boolean
  /** Aggregated terminal-visible state; see {@link DriverStatus}. */
  readonly status: DriverStatus
  /** Whether an interrupt (Esc / Ctrl+C) has parent-side work to stop. */
  readonly interruptible: boolean
  /** Current selection route, live. */
  get route(): { provider: string, model: string, effort: string | undefined }
  /** Submit one user turn (creates the session on first use; queues while running). */
  send(input: string | readonly ContentBlock[]): Promise<void>
  /** Submit one steering message for the next step of the running turn. */
  steer(input: string | readonly ContentBlock[]): Promise<void>
  /** Switch the model for the next step. */
  setModel(switchTo: ModelSwitch): void
  /** Set the agent preset applied when the (lazy) session materializes. */
  setPreset(id: string): void
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
  /** Report that a dialog is (or is no longer) waiting on the user. */
  setBlocked(kind: BlockedKind | undefined): void
  /** Observe status snapshots (fires on every change; returns its disposer). */
  onStatus(listener: (status: DriverStatus) => void): () => void
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
  let driverPreset = options.preset
  const statusListeners: Array<(status: DriverStatus) => void> = []

  let selectionRef: ModelSelectionRef | undefined
  let handle: { agent: Agent, dispose(): Promise<void> } | undefined
  let agent: Agent | undefined
  let running = false
  /** Compaction and other maintenance work: runs while public status is `idle`. */
  let maintenance = false
  /** Open LLM attempt ids — the only in-flight request signal outside the driver. */
  const openAttempts = new Set<string>()
  /** Live subagent activations, keyed by the `subagent/start`/`end` run id. */
  const liveSubagents = new Set<string>()
  /** Child session id → its live run ids; keys the orphan cleanup below. */
  const childRuns = new Map<string, Set<string>>()
  let blocked: BlockedKind | undefined
  let lastStatus: DriverStatus = aggregateStatus({
    running: false,
    maintenance: false,
    attempts: 0,
    subagents: 0,
    blocked: undefined,
  })
  let reaping = false
  let firstSeqAtWire = 0

  /** Recompute the aggregate and notify listeners on any change, including a
   *  count change that leaves `busy` set (a second subagent joining): the
   *  snapshot is public, so it must never go stale. Wire-level dedup belongs to
   *  the reporter, which would otherwise re-emit an identical escape. */
  const publishStatus = (): void => {
    const next = aggregateStatus({
      running,
      maintenance,
      attempts: openAttempts.size,
      subagents: liveSubagents.size,
      blocked,
    })
    if (
      next.running === lastStatus.running
      && next.busy === lastStatus.busy
      && next.blocked === lastStatus.blocked
      && next.maintenance === lastStatus.maintenance
      && next.attempts === lastStatus.attempts
      && next.subagents === lastStatus.subagents
    ) return
    lastStatus = next
    for (const callback of [...statusListeners]) callback(next)
  }

  /**
   * Reap the optimistic flags once the agent reaches true quiescence.
   * `whenIdle()` waits for the driver *and* maintenance tasks, so it is the
   * authoritative settle boundary; a missed `compaction/end` or stream `end`
   * frame then self-corrects instead of leaving the spinner spinning. Live
   * subagents keep their own accounting — they outlive a settled parent.
   */
  const reapWhenSettled = (wired: Agent): void => {
    if (reaping) return
    reaping = true
    void wired.whenIdle().then(() => {
      reaping = false
      if (agent !== wired) return
      // A wake in the microtask gap between the settle resolution and this
      // handler re-enters `running` synchronously; the live mirror is the
      // authority, so a genuinely restarted turn must survive the reap.
      if (wired.status !== 'idle') return
      running = false
      maintenance = false
      openAttempts.clear()
      publishStatus()
    }, () => {
      // A failed settle observation is corrected by the next status flip.
      reaping = false
    })
  }

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
          // Attempts opened before a driver hand-off belong to the retired one.
          openAttempts.clear()
          publishStatus()
          if (running) reapWhenSettled(wired)
        }
      }),
      ctx.on('agent/error', ({ agent: subject, error }) => {
        if (subject === wired) {
          const message = error instanceof Error ? error.message : String(error)
          model.pushNotice(t('notice.agentError', { message: message.slice(0, 180) }), 'error')
        }
      }),      ctx.on('session/event', (session, event) => {
        if (session !== wired.session) return
        // The compaction bracket is emitted by a plugin-contributed event type,
        // so it is narrowed structurally (same rule as TranscriptModel).
        const type: string = event.type
        if (type === 'compaction/start') {
          maintenance = true
          reapWhenSettled(wired)
          publishStatus()
        } else if (type === 'compaction/end') {
          maintenance = false
          publishStatus()
        }
        safeApply('event', () => model.applyEvent(event))
      }),
      ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
        if (subject !== wired) return
        if (frame.type === 'start') {
          openAttempts.add(String(frame.attemptId))
          reapWhenSettled(wired)
          publishStatus()
        } else if (frame.type === 'end') {
          openAttempts.delete(String(frame.attemptId))
          publishStatus()
        }
        safeApply('stream', () => model.applyFrame(frame as AssistantStreamFrameLike))
      }),
      // Subagent activations are background work: `subagent/start`/`subagent/end`
      // pair by run id, and their payload carries no parent, so registration
      // must happen on the agent's own scoped context — scope filtering keys the
      // dispatch by the delegating parent and would leak siblings on the root ctx.
      wired.ctx.on('subagent/start', (info) => {
        const runId = String(info.runId)
        const childId = String(info.id)
        liveSubagents.add(runId)
        const runs = childRuns.get(childId) ?? new Set<string>()
        runs.add(runId)
        childRuns.set(childId, runs)
        publishStatus()
      }),
      wired.ctx.on('subagent/end', (info) => {
        const runId = String(info.runId)
        const childId = String(info.id)
        liveSubagents.delete(runId)
        const runs = childRuns.get(childId)
        if (runs !== undefined) {
          runs.delete(runId)
          if (runs.size === 0) childRuns.delete(childId)
        }
        publishStatus()
      }),
      // A missed `subagent/end` would strand the aggregate at busy forever:
      // the settle watcher deliberately leaves subagents alone because
      // children legitimately outlive a settled parent. A disposed child can
      // never produce more work, so its disposal is the authoritative orphan
      // cleanup (non-local children have no Agent and no orphan path).
      ctx.on('agent/disposed', ({ agent: subject }) => {
        const childId = String(subject.id)
        const runs = childRuns.get(childId)
        if (runs === undefined) return
        childRuns.delete(childId)
        for (const runId of runs) liveSubagents.delete(runId)
        publishStatus()
      }),
      // Belt-and-braces reconcile: any single missed `agent/status` or stream
      // `end` event used to leave the spinner spinning after a cancel. While
      // the wired agent's own mirror says idle, no parent-side work can be in
      // flight, so a low-frequency tick heals the stale flags. Maintenance is
      // exempt: compaction runs while the public status stays idle, and only
      // `whenIdle()` — which waits for it — may clear that flag.
      (() => {
        const timer = setInterval(() => {
          if (agent !== wired || wired.status !== 'idle') return
          if (!running && openAttempts.size === 0) return
          running = false
          openAttempts.clear()
          publishStatus()
        }, 5_000)
        return () => clearInterval(timer)
      })(),
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
      // Group placement: the workspace registry keys groups by canonical path
      // and idempotently reuses an existing one, titling new groups with the
      // directory's final segment — the same rule the web UI's groups follow.
      // A session born under the group's directory attaches to the group; any
      // registry failure degrades to an ungrouped session, never blocking chat.
      let sessionCwd = cwd
      let workspaceAttach: ((sessionId: string) => Promise<void>) | undefined
      const registry = ctx.get('workspaceRegistry') as {
        create(path: string): Promise<{
          path: string
          attachSession(sessionId: unknown): Promise<void>
        }>
      } | undefined
      if (registry !== undefined) {
        try {
          const workspace = await registry.create(cwd)
          sessionCwd = workspace.path
          workspaceAttach = async sessionId => workspace.attachSession(sessionId)
        } catch {
          // Grouping is metadata; chat proceeds ungrouped.
        }
      }
      const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
      const meta: { cwd: string; agentPreset?: string } = { cwd: sessionCwd }
      if (driverPreset !== undefined) meta.agentPreset = driverPreset
      handle = await agents.create({ sessionId, meta: meta as never, agentOptions: agentOptions(), setup })
      if (workspaceAttach !== undefined) {
        try {
          await workspaceAttach(String(handle.agent.id))
        } catch {
          // Attached grouping is best-effort; the session stays usable.
        }
      }
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
    get busy(): boolean {
      return lastStatus.busy
    },
    get status(): DriverStatus {
      return lastStatus
    },
    /** Whether an interrupt (Esc / Ctrl+C) has parent-side work to stop. */
    get interruptible(): boolean {
      return running || maintenance
    },
    get route(): { provider: string, model: string, effort: string | undefined } {
      const current = selectionRef?.current
      const active = current === undefined ? selection : current
      return {
        provider: active.provider,
        model: active.model,
        effort: active.reasoningEffort,
      }
    },
    async send(input: string | readonly ContentBlock[]): Promise<void> {
      const wired = await ensureAgent()
      wired.followup(createUserMessage({
        content: typeof input === 'string' ? [{ type: 'text', text: input }] : input,
        source: { kind: 'user' },
      }))
    },
    async steer(input: string | readonly ContentBlock[]): Promise<void> {
      const wired = await ensureAgent()
      wired.steer(createUserMessage({
        content: typeof input === 'string' ? [{ type: 'text', text: input }] : input,
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
    setPreset(id: string): void {
      driverPreset = id
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
    setBlocked(kind: BlockedKind | undefined): void {
      if (blocked === kind) return
      blocked = kind
      publishStatus()
    },
    /** Observe status snapshots (fires on every change; returns its disposer). */
    onStatus(listener: (status: DriverStatus) => void): () => void {
      statusListeners.push(listener)
      // Late subscribers get the current state immediately.
      listener(lastStatus)
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
      // A retired agent reports no work: its flags must not leak to the next one.
      running = false
      maintenance = false
      blocked = undefined
      reaping = false
      openAttempts.clear()
      liveSubagents.clear()
      childRuns.clear()
      publishStatus()
    },
    async flush(): Promise<void> {
      if (agent === undefined) return
      await sessions.flush(agent.session)
    },
  }
}
