/**
 * The header status line is the only spinner in the app and the state a
 * terminal-side observer can see, so its visible/hidden flips are part of the
 * contract: they fire exactly once per change and are mirrored to subscribers.
 */
import { describe, expect, it } from 'vitest'
import { StatusLine } from '../src/components/status-line.ts'

/** Render the single line the component produces at a comfortable width. */
function lineOf(component: StatusLine): string {
  return component.render(60)[0] ?? ''
}

describe('StatusLine', () => {
  it('frames only while active, and asks for re-renders on flips', () => {
    const renders: number[] = []
    const status = new StatusLine(() => { renders.push(1) }, 10_000, ['A', 'B'])

    status.set('idle text', false)
    expect(lineOf(status)).toBe('idle text')
    // A text-only set never asks for a frame.
    expect(renders).toHaveLength(0)

    status.set('idle text', true)
    expect(lineOf(status)).toBe('A idle text')
    expect(renders).toHaveLength(1)

    // Same text and same active flag: cached, no notification.
    status.set('idle text', true)
    expect(renders).toHaveLength(1)

    // Text-only changes repaint nothing until the next frame tick.
    status.set('new text', true)
    expect(renders).toHaveLength(1)
    status.invalidate()
    expect(lineOf(status)).toBe('A new text')

    status.dispose()
    expect(lineOf(status)).toBe('new text')
  })

  it('reports the busy/idle flips an addon would mirror', () => {
    const status = new StatusLine(() => {}, 10_000, ['A'])
    const seen: boolean[] = []
    status.setOnActiveChange(active => { seen.push(active) })

    // The initial idle set is not a flip; neither is a text-only update.
    status.set('a', false)
    status.set('b', false)
    expect(seen).toEqual([])

    status.set('b', true)
    status.set('c', true)
    status.set('c', false)
    expect(seen).toEqual([true, false])

    // Disposing while visible is a flip too: nothing may keep showing "busy".
    status.set('c', true)
    expect(seen).toEqual([true, false, true])
    status.dispose()
    expect(seen).toEqual([true, false, true, false])
    status.dispose()
    expect(seen).toEqual([true, false, true, false])

    // Detaching stops notifications without changing the component.
    status.setOnActiveChange(undefined)
    status.dispose()
    expect(seen).toEqual([true, false, true, false])
  })
})
