/**
 * The transcript view model: one fold over the two surfaces the TUI renders
 * from — durable `SessionEvent`s and live `agent/assistant-stream` frames.
 *
 * Invariants (tested against recorded fixtures):
 * - Replay: folding only the durable events of a finished session produces
 *   the same items live streaming produced (stream/replay equivalence).
 * - Live streaming appends provisional items that the matching committed
 *   event *absorbs* (never duplicates): `assistant/message` finalizes the
 *   streaming assistant item, `tool/call` finalizes the streaming tool line.
 * - Events the fold does not understand are counted, never thrown.
 * @module dsh-tui/events
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Live `agent/assistant-stream` frames, structural view (see dsh-agent). */
export type AssistantStreamFrameLike =
  | { type: 'start'; attemptId: string; revision: number; turn: number; step: number }
  | { type: 'chunk'; attemptId: string; revision: number; index: number; time: number; chunk: StreamChunkLike }
  | { type: 'end'; attemptId: string; revision: number; index: number; outcome: { kind: 'committed'; eventType: string; seq: number } | { kind: 'abandoned' } }

/** LLM wire chunks as carried by stream frames (see dsh-llm StreamChunk). */
export type StreamChunkLike =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: { type: string } }
  | { type: 'usage' }
  | { type: 'finish'; reason?: unknown }

/** One usage record as carried by `assistant/message`. */
export interface UsageDelta {
  inputTokens: number
  outputTokens: number
}

export interface AssistantUsage extends UsageDelta {}

export type ToolStatus = 'running' | 'ok' | 'error'

/** The renderable transcript items, in order. */
export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; live: boolean; text: string; reasoning: string; usage: AssistantUsage | undefined }
  | { kind: 'tool'; id: string; callId: string; live: boolean; name: string; argDigest: string; status: ToolStatus; resultDigest: string | undefined }
  | { kind: 'notice'; id: string; text: string; tone: 'dim' | 'error' }

/** One raw event kept for the /events inspector. */
export interface RecentEventRecord {
  readonly seq: number
  readonly type: string
  readonly summary: string
}

const RECENT_EVENT_LIMIT = 300

/** Aggregate status the header bar renders. */
export interface TranscriptStatus {
  title: string | undefined
  preset: string | undefined
  inputTokens: number
  outputTokens: number
  unknownEventTypes: ReadonlyMap<string, number>
}

interface LiveAssistantState {
  itemIndex: number
  attemptId: string
  blockTypes: Map<number, string>
}

let nextLocalId = 0
const localId = (prefix: string): string => `local-${prefix}-${nextLocalId++}`

/**
 * The fold. Call {@link applyEvent} for every durable event and
 * {@link applyFrame} for every live stream frame of the driven session, in
 * arrival order; renderers read {@link items} and {@link status} and are
 * notified through {@link onChange}.
 */
export class TranscriptModel {
  private readonly changeListeners = new Set<() => void>()
  private readonly live = new Map<string, LiveAssistantState>()
  private readonly unknownCounts = new Map<string, number>()
  private queuedNotices: number[] = []
  private idCounter = 0

  readonly items: TranscriptItem[] = []
  /** Ring buffer of raw durable events for the /events inspector. */
  readonly recent: RecentEventRecord[] = []
  title: string | undefined
  /** Current permission preset name, from `permission/preset` events. */
  preset: string | undefined
  inputTokens = 0
  outputTokens = 0

  /** Register a change notification; returns its disposer. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  /** Clear everything for a session switch; keeps listeners and the items array identity. */
  reset(): void {
    this.items.length = 0
    this.live.clear()
    this.queuedNotices = []
    this.title = undefined
    this.preset = undefined
    this.inputTokens = 0
    this.outputTokens = 0
    this.changed()
  }

  get status(): TranscriptStatus {
    return {
      title: this.title,
      preset: this.preset,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      unknownEventTypes: this.unknownCounts,
    }
  }

  /** Local (non-durable) notice, e.g. the queue marker while a turn runs. */
  pushNotice(text: string, tone: 'dim' | 'error' = 'dim'): void {
    const index = this.items.length
    this.items.push({ kind: 'notice', id: localId('notice'), text, tone })
    if (tone === 'dim' && text.startsWith('(queued')) this.queuedNotices.push(index)
    this.changed()
  }

  applyFrame(frame: AssistantStreamFrameLike): void {
    if (frame.type === 'start') {
      const index = this.items.length
      this.items.push({
        kind: 'assistant',
        id: `live-${frame.attemptId}`,
        live: true,
        text: '',
        reasoning: '',
        usage: undefined,
      })
      this.live.set(frame.attemptId, { itemIndex: index, attemptId: frame.attemptId, blockTypes: new Map() })
      this.changed()
      return
    }
    if (frame.type === 'chunk') {
      const state = this.live.get(frame.attemptId)
      if (state === undefined) return
      const item = this.items[state.itemIndex]
      if (item?.kind !== 'assistant') return
      const chunk = frame.chunk
      switch (chunk.type) {
        case 'block-start':
          state.blockTypes.set(chunk.index, chunk.blockType)
          break
        case 'reasoning-delta':
          item.reasoning += chunk.text
          break
        case 'text-delta':
          item.text += chunk.text
          break
        case 'tool-call-delta': {
          this.upsertLiveTool(chunk.id, chunk.name, chunk.argumentsDelta)
          break
        }
        case 'usage':
        case 'block-end':
        case 'finish':
          break
      }
      this.changed()
      return
    }
    // end frame
    const state = this.live.get(frame.attemptId)
    if (state === undefined) return
    this.live.delete(frame.attemptId)
    if (frame.outcome.kind === 'abandoned') {
      const item = this.items[state.itemIndex]
      if (item?.kind === 'assistant' && item.live) {
        this.items.splice(state.itemIndex, 1, {
          kind: 'notice',
          id: item.id,
          text: '· attempt discarded',
          tone: 'dim',
        })
      }
      this.changed()
    }
    // committed ends are absorbed by the assistant/message event (below).
  }

  applyEvent(event: SessionEvent): void {
    this.remember(event)
    // Plugin-contributed event types (session/title, persistence delivery,
    // ...) are not in the base SessionEventMap; narrow them structurally.
    const type: string = event.type
    if (type === 'session/title') {
      this.title = (event as unknown as { data: { title: string } }).data.title
      this.changed()
      return
    }
    if (type.startsWith('session-log-deepseek/') || type.startsWith('llm/') || type.startsWith('plugin:')) {
      return
    }
    if (type === 'permission/preset') {
      this.preset = (event as unknown as { data: { preset: string } }).data.preset
      this.items.push({
        kind: 'notice',
        id: localId('preset'),
        text: `· permission → ${this.preset}`,
        tone: 'dim',
      })
      this.changed()
      return
    }
    if (type === 'command/run' || type === 'command/done') {
      // The TUI shows command results from its own dispatch path.
      return
    }
    switch (event.type) {
      case 'user/message': {
        // Only genuine human turns render; runtime context, skill catalogs,
        // and other injected user-role facts stay invisible.
        if (event.data.source.kind !== 'user') return
        this.dropQueuedNotices()
        this.items.push({
          kind: 'user',
          id: `u${this.idCounter++}`,
          text: event.data.content
            .filter(block => block.type === 'text')
            .map(block => (block.type === 'text' ? block.text : ''))
            .join(''),
        })
        break
      }
      case 'assistant/message': {
        const blocks = event.data.message.content
        const text = blocks.filter(block => block.type === 'text').map(block => (block.type === 'text' ? block.text : '')).join('')
        const reasoning = blocks.filter(block => block.type === 'reasoning').map(block => (block.type === 'reasoning' ? block.text : '')).join('')
        const usage: AssistantUsage | undefined = event.data.usage === undefined
          ? undefined
          : { inputTokens: event.data.usage.inputTokens, outputTokens: event.data.usage.outputTokens }
        if (usage !== undefined) {
          this.inputTokens += usage.inputTokens
          this.outputTokens += usage.outputTokens
        }
        // Absorb the still-live streaming item for this attempt, if any.
        const liveIndex = this.items.findIndex(item => item.kind === 'assistant' && item.live)
        if (liveIndex >= 0) {
          this.items.splice(liveIndex, 1, {
            kind: 'assistant',
            id: `a${this.idCounter++}`,
            live: false,
            text,
            reasoning,
            usage,
          })
        } else {
          this.items.push({
            kind: 'assistant',
            id: `a${this.idCounter++}`,
            live: false,
            text,
            reasoning,
            usage,
          })
        }
        break
      }
      case 'tool/call': {
        // Absorb the still-live tool line streaming its arguments.
        const liveIndex = this.items.findIndex(item => item.kind === 'tool' && item.live && item.callId === event.data.callId)
        const item: TranscriptItem = {
          kind: 'tool',
          id: `t${this.idCounter++}`,
          callId: event.data.callId,
          live: false,
          name: event.data.name,
          argDigest: digestToolArgs(event.data.name, event.data.arguments),
          status: 'running',
          resultDigest: undefined,
        }
        if (liveIndex >= 0) this.items.splice(liveIndex, 1, item)
        else this.items.push(item)
        break
      }
      case 'tool/result': {
        const callId = event.data.message.toolCallId
        const target = [...this.items].reverse().find(item => item.kind === 'tool' && item.callId === callId)
        if (target !== undefined && target.kind === 'tool') {
          target.status = event.data.message.isError === true ? 'error' : 'ok'
          target.resultDigest = digestToolResult(event.data.message.content)
        } else {
          this.countUnknown('tool/result(unpaired)')
        }
        break
      }
      case 'turn/end': {
        if (event.data.reason.kind !== 'completed') {
          const detail = event.data.reason.kind === 'error'
            ? `: ${(event.data.reason as { error: { message: string } }).error.message}`
            : ''
          const text = `· turn ${event.data.reason.kind}${detail}`
          this.items.push({
            kind: 'notice',
            id: localId('turn'),
            text: text.length > 200 ? `${text.slice(0, 199)}…` : text,
            tone: event.data.reason.kind === 'error' ? 'error' : 'dim',
          })
        }
        break
      }
      case 'assistant/attempt': {
        this.items.push({ kind: 'notice', id: localId('attempt'), text: '· attempt discarded', tone: 'dim' })
        break
      }
      case 'turn/start':
      case 'step/start':
      case 'step/end':
      case 'system/message':
      case 'request/header':
      case 'request/context':
      case 'agent/inbox/spliced':
        // Structural events the transcript does not render.
        break
      default:
        this.countUnknown(event.type)
        return
    }
    this.changed()
  }

  /** Keep one raw event for the inspector, bounded. */
  private remember(event: SessionEvent): void {
    let summary: string
    try {
      summary = JSON.stringify(event.data) ?? ''
    } catch {
      summary = '(unserializable)'
    }
    if (summary.length > 240) summary = `${summary.slice(0, 239)}…`
    this.recent.push({ seq: Number(event.seq), type: event.type, summary })
    if (this.recent.length > RECENT_EVENT_LIMIT) this.recent.splice(0, this.recent.length - RECENT_EVENT_LIMIT)
  }

  private upsertLiveTool(callId: string, name: string | undefined, argsDelta: string): void {    const existing = this.items.find(item => item.kind === 'tool' && item.live && item.callId === callId)
    if (existing !== undefined && existing.kind === 'tool') {
      existing.argDigest = digestToolArgs(existing.name, rawArgsAppend(existing.argDigest, argsDelta))
      return
    }
    this.items.push({
      kind: 'tool',
      id: `live-${callId}`,
      callId,
      live: true,
      name: name ?? '…',
      argDigest: digestToolArgs(name ?? '', argsDelta),
      status: 'running',
      resultDigest: undefined,
    })
  }

  private dropQueuedNotices(): void {
    if (this.queuedNotices.length === 0) return
    for (const index of this.queuedNotices.reverse()) this.items.splice(index, 1)
    this.queuedNotices = []
  }

  private countUnknown(type: string): void {
    this.unknownCounts.set(type, (this.unknownCounts.get(type) ?? 0) + 1)
  }

  private changed(): void {
    for (const listener of this.changeListeners) listener()
  }
}

function rawArgsAppend(currentDigest: string, delta: string): string {
  // Live tool lines show a plain text digest; JSON completeness is not needed
  // mid-stream, so keep appending visible text and let the digest helper
  // extract the first interesting field it can find.
  return `${currentDigest}${delta}`
}

/** One-line argument digest for a tool call: its most identifying field. */
export function digestToolArgs(name: string, rawArgs: string): string {
  try {
    const parsed: unknown = JSON.parse(rawArgs)
    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      for (const key of ['command', 'pattern', 'path', 'query', 'url', 'prompt']) {
        const value = record[key]
        if (typeof value === 'string' && value !== '') return value
      }
      const first = Object.values(record).find(value => typeof value === 'string' && value !== '')
      if (typeof first === 'string') return first
      return rawArgs
    }
  } catch {
    // Partial JSON while streaming: show the raw text, truncated.
  }
  return rawArgs
}

/** One-line result digest: first text block, truncated. */
export function digestToolResult(content: ReadonlyArray<{ type: string }>): string | undefined {
  const first = content.find(block => block.type === 'text') as { type: 'text'; text: string } | undefined
  if (first === undefined) return undefined
  const single = first.text.split('\n').find(line => line.trim() !== '') ?? ''
  return single.length > 72 ? `${single.slice(0, 71)}…` : single
}
