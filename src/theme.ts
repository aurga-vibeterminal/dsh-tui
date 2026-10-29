/**
 * Semantic theme tokens for dsh-tui.
 *
 * Each theme is a palette of foreground wrappers rendered as truecolor (RGB)
 * when the terminal advertises support and plain ANSI 16-color codes
 * otherwise. The dark palette is tuned for dark terminal backgrounds (light
 * text), the light palette for light backgrounds (dark text, ≥ 4.5:1 against
 * white for text hues) — so switching re-skins every surface, body text
 * included, not just a couple of accents.
 */

export interface Theme {
  readonly text: (text: string) => string
  readonly dim: (text: string) => string
  readonly accent: (text: string) => string
  readonly user: (text: string) => string
  readonly tool: (text: string) => string
  readonly success: (text: string) => string
  readonly warning: (text: string) => string
  readonly error: (text: string) => string
  readonly border: (text: string) => string
}

/** One token's colors: a truecolor hex plus the ANSI-16 fallback codes. */
export interface ThemeColor {
  readonly hex: string
  readonly ansi: readonly [open: string, close: string]
}

export interface ThemeColors {
  readonly text: ThemeColor
  readonly dim: ThemeColor
  readonly accent: ThemeColor
  readonly user: ThemeColor
  readonly tool: ThemeColor
  readonly success: ThemeColor
  readonly warning: ThemeColor
  readonly error: ThemeColor
  readonly border: ThemeColor
}

export const darkColors: ThemeColors = {
  text: { hex: '#E8E8E8', ansi: ['\x1b[97m', '\x1b[39m'] },
  dim: { hex: '#8A8A8A', ansi: ['\x1b[2m', '\x1b[22m'] },
  accent: { hex: '#4FC3F7', ansi: ['\x1b[36m', '\x1b[39m'] },
  user: { hex: '#4FC3F7', ansi: ['\x1b[36m', '\x1b[39m'] },
  tool: { hex: '#C792EA', ansi: ['\x1b[35m', '\x1b[39m'] },
  success: { hex: '#81C784', ansi: ['\x1b[32m', '\x1b[39m'] },
  warning: { hex: '#FFB74D', ansi: ['\x1b[33m', '\x1b[39m'] },
  error: { hex: '#F28B82', ansi: ['\x1b[31m', '\x1b[39m'] },
  border: { hex: '#6B6B6B', ansi: ['\x1b[90m', '\x1b[39m'] },
}

export const lightColors: ThemeColors = {
  text: { hex: '#1F1F1F', ansi: ['\x1b[30m', '\x1b[39m'] },
  dim: { hex: '#5F5F5F', ansi: ['\x1b[90m', '\x1b[39m'] },
  accent: { hex: '#1565C0', ansi: ['\x1b[34m', '\x1b[39m'] },
  user: { hex: '#1565C0', ansi: ['\x1b[34m', '\x1b[39m'] },
  tool: { hex: '#8E24AA', ansi: ['\x1b[35m', '\x1b[39m'] },
  success: { hex: '#2E7D32', ansi: ['\x1b[32m', '\x1b[39m'] },
  warning: { hex: '#9A6700', ansi: ['\x1b[33m', '\x1b[39m'] },
  error: { hex: '#C62828', ansi: ['\x1b[31m', '\x1b[39m'] },
  border: { hex: '#9E9E9E', ansi: ['\x1b[90m', '\x1b[39m'] },
}

const wrap = (open: string, close: string) => (text: string): string => `${open}${text}${close}`

let truecolorCache: boolean | undefined

/** Truecolor support probe (cached; the environment does not change mid-run). */
export function trueColorEnabled(): boolean {
  if (truecolorCache === undefined) {
    const program = process.env.TERM_PROGRAM
    truecolorCache = process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit'
      || program === 'iTerm.app' || program === 'vscode' || program === 'Apple_Terminal'
      || process.env.WT_SESSION !== undefined || process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  }
  return truecolorCache
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/** A palette entry as a foreground wrapper: truecolor, or the ANSI fallback. */
function colorWrapper(color: ThemeColor, truecolor: boolean): (text: string) => string {
  if (!truecolor) return wrap(color.ansi[0], color.ansi[1])
  const [r, g, b] = hexToRgb(color.hex)
  return wrap(`\x1b[38;2;${String(r)};${String(g)};${String(b)}m`, '\x1b[39m')
}

/** Materialize one theme from its palette (probe-independent, testable). */
export function buildTheme(colors: ThemeColors, truecolor: boolean): Theme {
  return {
    text: colorWrapper(colors.text, truecolor),
    dim: colorWrapper(colors.dim, truecolor),
    accent: colorWrapper(colors.accent, truecolor),
    user: colorWrapper(colors.user, truecolor),
    tool: colorWrapper(colors.tool, truecolor),
    success: colorWrapper(colors.success, truecolor),
    warning: colorWrapper(colors.warning, truecolor),
    error: colorWrapper(colors.error, truecolor),
    border: colorWrapper(colors.border, truecolor),
  }
}

export const darkTheme: Theme = buildTheme(darkColors, trueColorEnabled())
export const lightTheme: Theme = buildTheme(lightColors, trueColorEnabled())

export function themeByName(name: string | undefined): Theme {
  if (name === 'light') return lightTheme
  return darkTheme
}

export const THEME_NAMES = ['dark', 'light'] as const

import type { MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'

/** pi-tui Markdown theme derived from one semantic theme. */
export function markdownThemeFor(theme: Theme): MarkdownTheme {
  const identity = (text: string): string => text
  return {
    heading: theme.accent,
    link: theme.accent,
    linkUrl: theme.dim,
    code: theme.tool,
    codeBlock: identity,
    codeBlockBorder: theme.dim,
    quote: theme.dim,
    quoteBorder: theme.dim,
    hr: theme.dim,
    listBullet: theme.accent,
    bold: (text) => `\x1b[1m${text}\x1b[22m`,
    italic: (text) => `\x1b[3m${text}\x1b[23m`,
    strikethrough: theme.dim,
    underline: (text) => `\x1b[4m${text}\x1b[24m`,
  }
}

/** pi-tui SelectList theme derived from one semantic theme. */
export function selectListThemeFor(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: theme.accent,
    selectedText: theme.accent,
    description: theme.dim,
    scrollInfo: theme.dim,
    noMatch: theme.dim,
  }
}

/**
 * SelectList theme that reads the CURRENT theme on every call, so surfaces
 * constructed once (the editor's autocomplete palette) re-skin when the
 * theme ref is swapped instead of keeping the palette they were built with.
 */
export function liveSelectListTheme(getTheme: () => Theme): SelectListTheme {
  return {
    selectedPrefix: (text) => getTheme().accent(text),
    selectedText: (text) => getTheme().accent(text),
    description: (text) => getTheme().dim(text),
    scrollInfo: (text) => getTheme().dim(text),
    noMatch: (text) => getTheme().dim(text),
  }
}
