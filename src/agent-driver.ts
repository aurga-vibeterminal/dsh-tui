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
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { AssistantStreamFrameLike, TranscriptModel } from './events.ts'

/** Route override from the command line; absent keeps the profile default. */
export interface DriverModelRoute {
  provider: string
  model: string
}

export interface DriverOptions {
  /** Persisted session id to resume; absent creates a fresh session. */
  resume: string | undefined
  /** Explicit model route; absent keeps the default selection. */
  model: DriverModelRoute | undefined
}

export interface AgentDriver {
  readonly session: Agent['session']
  readonly model: TranscriptModel
  /** Current live status of the whole agent. */
  readonly running: boolean
  /** Enqueue one user turn (queues into the inbox while a turn runs). */
  send(text: string): void
  /** Interrupt the running turn, keeping queued input. */
  cancel(): void
  /** Stop feeding the model; resolves after subscriptions are dropped. */
  stop(): void
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
  const setup = (agentCtx: Context): void => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }

  const fs = ctx.get('fs')
  const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))

  let agent: Agent
  if (options.resume === undefined) {
    const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
    agent = (await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })).agent
  } else {
    if (ctx.get('sessionPersistence') === undefined) {
      throw new Error('tui --resume requires the sessionPersistence service; dsh-base provides it')
    }
    const resumeSessionId = brandString<SessionId>(options.resume)
    try {
      agent = (await agents.resume({ resumeSessionId, agentOptions, setup })).agent
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
    cancel(): void {
      agent.cancel({ kind: 'user' }, { keepInbox: true })
    },
    stop(): void {
      stopEvents()
      stopStream()
      stopStatus()
      stopErrors()
    },
    async flush(): Promise<void> {
      await sessions.flush(agent.session)
    },
  }
}
