import { describe, expect, it } from 'vitest'

import {
  THEME_NAMES,
  buildTheme,
  darkColors,
  darkTheme,
  lightColors,
  lightTheme,
  liveSelectListTheme,
  markdownThemeFor,
  themeByName,
} from '../src/theme.ts'
import { TranscriptView } from '../src/components/transcript.ts'
import type { ItemContext } from '../src/components/transcript.ts'
import type { TranscriptItem } from '../src/events.ts'

const TOKENS = ['text', 'dim', 'accent', 'user', 'tool', 'success', 'warning', 'error', 'border'] as const

describe('theme palettes', () => {
  it('dark and light differ on every token in truecolor mode', () => {
    const dark = buildTheme(darkColors, true)
    const light = buildTheme(lightColors, true)
    for (const token of TOKENS) {
      expect(dark[token]('x'), token).not.toBe(light[token]('x'))
    }
  })

  it('body text flips between near-white and near-black', () => {
    expect(buildTheme(darkColors, true).text('x')).toBe('\x1b[38;2;232;232;232mx\x1b[39m')
    expect(buildTheme(lightColors, true).text('x')).toBe('\x1b[38;2;31;31;31mx\x1b[39m')
  })

  it('falls back to ANSI 16-color codes without truecolor', () => {
    const dark = buildTheme(darkColors, false)
    expect(dark.text('x')).toBe('\x1b[97mx\x1b[39m')
    expect(dark.dim('x')).toBe('\x1b[2mx\x1b[22m')
    const light = buildTheme(lightColors, false)
    expect(light.text('x')).toBe('\x1b[30mx\x1b[39m')
    expect(light.accent('x')).toBe('\x1b[34mx\x1b[39m')
  })

  it('exposes both names through themeByName', () => {
    expect(themeByName('light')).toBe(lightTheme)
    expect(themeByName('dark')).toBe(darkTheme)
    expect(themeByName(undefined)).toBe(darkTheme)
    expect(themeByName('bogus')).toBe(darkTheme)
    expect(THEME_NAMES).toEqual(['dark', 'light'])
  })
})

describe('liveSelectListTheme', () => {
  it('re-skins when the theme ref is swapped', () => {
    const ref = { current: buildTheme(darkColors, false) }
    const list = liveSelectListTheme(() => ref.current)
    const before = list.selectedPrefix('›')
    ref.current = buildTheme(lightColors, false)
    expect(list.selectedPrefix('›')).not.toBe(before)
  })
})

describe('themed transcript surfaces', () => {
  // Fixed palette (no truecolor probe) so the expected codes are deterministic.
  const context = (theme: ReturnType<typeof buildTheme>): ItemContext =>
    ({ theme, markdownTheme: markdownThemeFor(theme) })

  const items: readonly TranscriptItem[] = [
    { kind: 'user', id: 'u1', text: 'hello there' },
    { kind: 'assistant', id: 'a1', live: false, text: 'general **kenobi**', reasoning: '', usage: undefined },
  ]

  it('colors user and assistant body text with the theme text token', () => {
    const view = new TranscriptView(items, context(buildTheme(darkColors, false)))
    const lines = view.render(80).join('\n')
    expect(lines).toContain('\x1b[97mhello there')
    expect(lines).toContain('\x1b[97mgeneral ')
  })

  it('re-renders both shades after a theme swap', () => {
    const view = new TranscriptView(items, context(buildTheme(darkColors, false)))
    view.setContext(context(buildTheme(lightColors, false)))
    const lines = view.render(80).join('\n')
    expect(lines).toContain('\x1b[30mhello there')
    expect(lines).not.toContain('\x1b[97mhello there')
  })
})
