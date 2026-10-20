/**
 * Semantic theme tokens for dsh-tui.
 *
 * Phase 1 ships one dark theme as plain ANSI wrappers (no color library);
 * truecolor/256 downgrade arrives with the full theme system in Phase 3.
 * Every function takes pre-rendered text and returns ANSI-wrapped text, the
 * shape pi-tui components and `wrapTextWithAnsi` expect.
 */

export interface Theme {
  readonly dim: (text: string) => string
  readonly accent: (text: string) => string
  readonly user: (text: string) => string
  readonly tool: (text: string) => string
  readonly success: (text: string) => string
  readonly warning: (text: string) => string
  readonly error: (text: string) => string
  readonly border: (text: string) => string
}

const wrap = (open: string, close: string) => (text: string): string => `${open}${text}${close}`

export const darkTheme: Theme = {
  dim: wrap('\x1b[2m', '\x1b[22m'),
  accent: wrap('\x1b[36m', '\x1b[39m'),
  user: wrap('\x1b[36m', '\x1b[39m'),
  tool: wrap('\x1b[35m', '\x1b[39m'),
  success: wrap('\x1b[32m', '\x1b[39m'),
  warning: wrap('\x1b[33m', '\x1b[39m'),
  error: wrap('\x1b[31m', '\x1b[39m'),
  border: wrap('\x1b[90m', '\x1b[39m'),
}

export function themeByName(name: string | undefined): Theme {
  // Light and custom themes land with the Phase 3 theme system.
  return darkTheme
}
