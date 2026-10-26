/**
 * Performance guard (PLAN §7.3 carry-over): folding a long session must stay
 * interactive. Replays a synthetic ~50k-event stream (the recorded shapes,
 * replicated) through the fold and budgets one second; also measures a full
 * first render and a cached re-render for visibility in CI output.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TranscriptModel } from '../src/events.ts'
import { TranscriptView, type ItemContext } from '../src/components/transcript.ts'
import { markdownThemeFor, themeByName } from '../src/theme.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? '.' : path.slice(0, index)
}

const template = readFileSync(join(fixturesRoot, 'basic-chat', 'events.jsonl'), 'utf8')
  .split('\n')
  .filter(line => line !== '')
  .map(line => JSON.parse(line) as SessionEvent)

function buildLargeStream(rounds: number): SessionEvent[] {
  const stream: SessionEvent[] = []
  let seq = 0
  for (let round = 0; round < rounds; round += 1) {
    for (const event of template) {
      const copy = { ...event, seq, data: structuredCloneSafe(event.data) } as SessionEvent
      stream.push(copy)
      seq += 1
    }
  }
  return stream
}

function structuredCloneSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown
}

describe('fold performance', () => {
  it('folds ~50k events in under a second', () => {
    const stream = buildLargeStream(3200)
    expect(stream.length).toBeGreaterThanOrEqual(50_000)
    const model = new TranscriptModel()
    const started = performance.now()
    for (const event of stream) model.applyEvent(event)
    const elapsed = performance.now() - started
    // eslint-disable-next-line no-console
    console.log(`fold: ${String(stream.length)} events in ${elapsed.toFixed(0)}ms; items=${String(model.items.length)}`)
    expect(elapsed).toBeLessThan(1000)
    expect(model.items.length).toBeGreaterThan(5000)
  })

  it('renders a long transcript and re-renders from cache quickly', () => {
    const stream = buildLargeStream(600)
    const model = new TranscriptModel()
    for (const event of stream) model.applyEvent(event)
    const theme = themeByName('dark')
    const context: ItemContext = { theme, markdownTheme: markdownThemeFor(theme) }
    const view = new TranscriptView(model.items, context)

    const firstStart = performance.now()
    const lines = view.render(80)
    const firstElapsed = performance.now() - firstStart

    const cachedStart = performance.now()
    view.render(80)
    const cachedElapsed = performance.now() - cachedStart

    // eslint-disable-next-line no-console
    console.log(`render: ${String(lines.length)} lines first=${firstElapsed.toFixed(0)}ms cached=${cachedElapsed.toFixed(0)}ms`)
    // The budget is generous for CI noise; the cached pass is the steady state.
    expect(cachedElapsed).toBeLessThan(150)
    expect(lines.length).toBeGreaterThan(5_000)
  })
})
