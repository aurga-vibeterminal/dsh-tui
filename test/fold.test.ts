/**
 * Fold tests over the recorded fixtures (Phase 0 · Spike 3):
 * - durable replay produces the expected items,
 * - live streaming reaches the identical final state (stream/replay
 *   equivalence, PLAN §9.1),
 * - tool calls pair with results and carry digests.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { TranscriptModel, type AssistantStreamFrameLike } from '../src/events.ts'
import { TranscriptView } from '../src/components/transcript.ts'
import { markdownThemeFor, themeByName } from '../src/theme.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadFixture(name: string): { events: SessionEvent[]; frames: AssistantStreamFrameLike[] } {
  const events = readFileSync(join(fixturesRoot, name, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as SessionEvent)
  const frames = readFileSync(join(fixturesRoot, name, 'stream.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => (JSON.parse(line) as { frame: AssistantStreamFrameLike }).frame)
  return { events, frames }
}

/** Interleave frames and events in realistic arrival order. */
function* interleaved(events: readonly SessionEvent[], frames: readonly AssistantStreamFrameLike[]): Generator<SessionEvent | AssistantStreamFrameLike> {
  // In reality: turn/step/input events land first (seq < settlement), the
  // chunks stream next, then the loop commits the settlement event(s), then
  // the end frame arrives. Approximate per attempt using the end frame's
  // committed seq as the settlement boundary.
  const pendingFrames = [...frames]
  const startIndexes: number[] = []
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index]!.type === 'start') startIndexes.push(index)
  }
  let frameCursor = 0
  let eventCursor = 0
  for (const _start of startIndexes) {
    const endFrame = pendingFrames.find((frame, index) => index >= frameCursor && frame.type === 'end')
    const commitSeq = endFrame !== undefined && endFrame.type === 'end' && endFrame.outcome.kind === 'committed'
      ? endFrame.outcome.seq
      : Number.MAX_SAFE_INTEGER
    // Events strictly before the settlement precede the streamed chunks.
    while (eventCursor < events.length && Number(events[eventCursor]!.seq) < commitSeq) {
      yield events[eventCursor]!
      eventCursor += 1
    }
    // The attempt's frames, excluding its end.
    while (frameCursor < pendingFrames.length && pendingFrames[frameCursor]!.type !== 'end') {
      yield pendingFrames[frameCursor]!
      frameCursor += 1
    }
    // The settlement event(s), then the end frame.
    while (eventCursor < events.length && Number(events[eventCursor]!.seq) <= commitSeq) {
      yield events[eventCursor]!
      eventCursor += 1
    }
    if (frameCursor < pendingFrames.length) {
      yield pendingFrames[frameCursor]!
      frameCursor += 1
    }
  }
  while (eventCursor < events.length) {
    yield events[eventCursor]!
    eventCursor += 1
  }
}

function dirname(path: string): string {
  const separator = path.lastIndexOf('/')
  const backslash = path.lastIndexOf('\\')
  const index = Math.max(separator, backslash)
  return index === -1 ? '.' : path.slice(0, index)
}

describe('TranscriptModel · durable replay (basic-chat)', () => {
  const { events } = loadFixture('basic-chat')

  it('renders one user turn and one assistant message, skipping injected context', () => {
    const model = new TranscriptModel()
    for (const event of events) model.applyEvent(event)

    const users = model.items.filter(item => item.kind === 'user')
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ text: '用中文解释快速排序，并给出 TypeScript 实现' })

    const assistants = model.items.filter(item => item.kind === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ live: false })
    expect((assistants[0] as { text: string }).text).toContain('quickSort')
    expect((assistants[0] as { reasoning: string }).reasoning).not.toBe('')
  })

  it('aggregates usage and captures the session title', () => {
    const model = new TranscriptModel()
    for (const event of events) model.applyEvent(event)
    expect(model.inputTokens).toBeGreaterThan(0)
    expect(model.outputTokens).toBeGreaterThan(0)
    expect(model.title).toBeDefined()
  })
})

describe('TranscriptModel · stream/replay equivalence (basic-chat)', () => {
  const { events, frames } = loadFixture('basic-chat')

  it('live streaming reaches the same final state as durable replay', () => {
    const replay = new TranscriptModel()
    for (const event of events) replay.applyEvent(event)

    const live = new TranscriptModel()
    for (const record of interleaved(events, frames)) {
      if ('seq' in record && 'type' in record && typeof record.seq === 'number') live.applyEvent(record)
      else live.applyFrame(record as AssistantStreamFrameLike)
    }

    expect(live.items).toEqual(replay.items)
    expect(live.title).toBe(replay.title)
    expect(live.inputTokens).toBe(replay.inputTokens)
  })
})

describe('TranscriptModel · tool calls (tool-call)', () => {
  const { events } = loadFixture('tool-call')

  it('pairs tool calls with results and derives digests', () => {
    const model = new TranscriptModel()
    for (const event of events) model.applyEvent(event)

    const tools = model.items.filter(item => item.kind === 'tool')
    expect(tools).toHaveLength(1)
    const tool = tools[0] as { name: string; argDigest: string; status: string; resultDigest: string | undefined }
    expect(tool.name).toBe('glob')
    expect(tool.argDigest).toBe('*.md')
    expect(tool.status).toBe('ok')
    expect(tool.resultDigest).toBeDefined()

    const assistants = model.items.filter(item => item.kind === 'assistant')
    expect(assistants).toHaveLength(2)

    // No live items survive the finished turn.
    expect(model.items.some(item => 'live' in item && item.live)).toBe(false)
  })
})

describe('TranscriptModel · notices and unknown events', () => {
  it('counts unknown event types instead of throwing', () => {
    const model = new TranscriptModel()
    model.applyEvent({ type: 'some-future/event', seq: 1, time: 0, data: {} } as unknown as SessionEvent)
    expect(model.status.unknownEventTypes.get('some-future/event')).toBe(1)
    expect(model.items).toHaveLength(0)
  })

  it('drops the local queue notice when the real user message lands', () => {
    const model = new TranscriptModel()
    model.pushNotice('(queued: hello)')
    expect(model.items).toHaveLength(1)
    model.applyEvent({
      type: 'user/message',
      seq: 1,
      time: 0,
      data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' }, role: 'user', id: 'x' },
    } as unknown as SessionEvent)
    expect(model.items.filter(item => item.kind === 'notice')).toHaveLength(0)
    expect(model.items.filter(item => item.kind === 'user')).toHaveLength(1)
  })

  it('tracks permission preset switches as notices', () => {
    const model = new TranscriptModel()
    model.applyEvent({ type: 'permission/preset', seq: 1, time: 0, data: { preset: 'danger-full-access' } } as unknown as SessionEvent)
    expect(model.preset).toBe('danger-full-access')
    expect(model.items.some(item => item.kind === 'notice' && item.text.includes('danger-full-access'))).toBe(true)
    expect(model.status.preset).toBe('danger-full-access')
  })

  it('tracks model and working-directory switches as notices', () => {
    const model = new TranscriptModel()
    model.applyEvent({ type: 'model/selection', seq: 1, time: 0, data: { selection: { provider: 'deepseek-account', model: 'deepseek-v4-pro' } } } as unknown as SessionEvent)
    expect(model.model).toBe('deepseek-account/deepseek-v4-pro')
    expect(model.items.some(item => item.kind === 'notice' && item.text.includes('model →'))).toBe(true)

    model.applyEvent({ type: 'working-directory/change', seq: 2, time: 0, data: { cwd: 'D:\\other' } } as unknown as SessionEvent)
    expect(model.items.some(item => item.kind === 'notice' && item.text.includes('cwd → D:\\other'))).toBe(true)
  })

  it('tracks todos from todo/write events', () => {
    const model = new TranscriptModel()
    model.applyEvent({
      type: 'todo/write', seq: 1, time: 0,
      data: { todos: [
        { content: 'first', status: 'completed' },
        { content: 'second', status: 'in_progress' },
      ] },
    } as unknown as SessionEvent)
    expect(model.todos).toEqual([
      { content: 'first', status: 'completed' },
      { content: 'second', status: 'in_progress' },
    ])
    expect(model.items.some(item => item.kind === 'notice' && item.text.includes('todos 1/2'))).toBe(true)
    model.reset()
    expect(model.todos).toBeUndefined()
  })

  it('resets in place for a session switch (array identity preserved)', () => {
    const model = new TranscriptModel()
    model.applyEvent({
      type: 'user/message',
      seq: 1,
      time: 0,
      data: { content: [{ type: 'text', text: 'old' }], source: { kind: 'user' }, role: 'user', id: 'x' },
    } as unknown as SessionEvent)
    const items = model.items
    let notified = 0
    const dispose = model.onChange(() => { notified += 1 })

    model.reset()

    expect(model.items).toBe(items)
    expect(model.items).toHaveLength(0)
    expect(model.title).toBeUndefined()
    expect(model.preset).toBeUndefined()
    expect(model.inputTokens).toBe(0)
    expect(notified).toBeGreaterThan(0)
    dispose()
  })
})

describe('interrupted turn · fold and render the aborted state', () => {
  const { events, frames } = loadFixture('interrupted')

  it('folds a cancelled turn without throwing and renders it at every width', () => {
    const theme = themeByName('dark')
    const model = new TranscriptModel()
    const view = new TranscriptView(model.items, { theme, markdownTheme: markdownThemeFor(theme) })
    const dispose = model.onChange(() => {
      view.invalidate()
    })

    for (const record of interleaved(events, frames)) {
      if ('seq' in record && 'type' in record && typeof record.seq === 'number') model.applyEvent(record)
      else model.applyFrame(record as AssistantStreamFrameLike)
    }

    // The abandoned attempt renders as a dim notice; the turn badge is aborted.
    const notices = model.items.filter(item => item.kind === 'notice')
    expect(notices.some(notice => notice.kind === 'notice' && notice.text.includes('turn aborted'))).toBe(true)

    // Rendering the final state must not throw at common widths.
    for (const width of [40, 60, 80, 120]) {
      const lines = view.render(width)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
    }
    dispose()
  })
})

describe('app wiring · model changes must invalidate the transcript view', () => {  it('re-renders new items when wired through onChange→invalidate (regression)', () => {
    const theme = themeByName('dark')
    const model = new TranscriptModel()
    const view = new TranscriptView(model.items, { theme, markdownTheme: markdownThemeFor(theme) })
    const dispose = model.onChange(() => {
      view.invalidate()
    })

    const before = view.render(48)
    model.applyEvent({
      type: 'user/message',
      seq: 1,
      time: 0,
      data: { content: [{ type: 'text', text: '你好世界' }], source: { kind: 'user' }, role: 'user', id: 'x' },
    } as unknown as SessionEvent)
    const after = view.render(48)

    expect(after.length).toBeGreaterThan(before.length)
    expect(after.join('\n')).toContain('你好世界')

    // And without the invalidate call the view would still show the old
    // lines — assert the cache actually resets through the wired path.
    dispose()
  })
})
