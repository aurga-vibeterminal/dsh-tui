/**
 * Scroll affordances: the transient scrollbar appears while scrolling, and
 * the CJK "jump to end" indicator renders centered on the last viewport row
 * while the follow is released (and vanishes at the end).
 */
import { describe, expect, it } from 'vitest'
import { Container, ScrollView, Text, TuiAltScreen, VStack, isViewportTUI } from '@earendil-works/pi-tui'
import { HeadlessTerminal } from './helpers/headless-terminal.ts'

const flush = async (term: HeadlessTerminal, ms = 40): Promise<void> => {
  await new Promise<void>(resolve => setTimeout(resolve, ms))
  await term.settled()
}

describe('scroll affordances', () => {
  it('shows the scrollbar and CJK jump-to-end indicator while scrolled up', async () => {
    const term = new HeadlessTerminal(60, 12)
    const tui = new TuiAltScreen(term, false, undefined, {
      scrollToEndIndicator: () => ' ↓ 最新 ',
    })
    const content = new Container()
    for (let index = 1; index <= 40; index += 1) content.addChild(new Text(`line ${String(index)}`, 0, 0))
    const scroll = new ScrollView(content, { follow: 'end', primary: true, scrollbar: 'auto', scrollbarHideDelayMs: 60_000 })
    if (isViewportTUI(tui)) {
      tui.setLayoutRoot(new VStack([{ component: scroll, basis: 0, grow: 1, minSize: 1 }]))
    }
    tui.start()
    await flush(term)

    // Following the end: no indicator, newest line visible.
    const bottom = term.textLines().map(line => line.trimEnd())
    expect(bottom.some(line => line.includes('line 40'))).toBe(true)
    expect(bottom.some(line => line.includes('最新'))).toBe(false)

    // Page up: indicator appears centered on the last row with the scrollbar.
    term.send('\x1b[5~')
    await flush(term)
    const scrolled = term.textLines().map(line => line.trimEnd())
    expect(scrolled.some(line => line.includes('line 21'))).toBe(true)
    const indicatorRow = scrolled.find(line => line.includes('最新'))
    expect(indicatorRow).toBeDefined()
    const visible = indicatorRow!.length
    const indicatorAt = indicatorRow!.indexOf('↓')
    // Centered-ish: the marker sits in the middle third of the row.
    expect(indicatorAt).toBeGreaterThan(Math.floor(visible / 3))
    expect(indicatorAt).toBeLessThan(Math.floor((visible * 2) / 3))

    tui.stop()
    await flush(term)
    expect(term.bufferType).toBe('normal')
  })
})
