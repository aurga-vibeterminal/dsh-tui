/**
 * Dev logging and screen-output custody.
 *
 * While the TUI owns the screen, ANY stray write to the terminal garbles the
 * alt-screen viewport. Two channels need custody:
 * - `process.stderr.write` — replaced directly;
 * - the global `console.*` methods — Node's console binds its write functions
 *   at bootstrap, so replacing `process.stderr.write` alone does not affect
 *   them (the harness logs diagnostics like the account model listing through
 *   `console.info`/`console.warn`).
 *
 * Captured output is teed into the debug log file (DSH_TUI_LOG) instead of
 * the terminal. Our own debug lines also go there.
 */

import { appendFile } from 'node:fs/promises'
import { format } from 'node:util'
import process from 'node:process'

export interface Logger {
  debug(message: string): void
}

/** A logger writing to the DSH_TUI_LOG file, or a no-op when unset. */
export function createDebugLogger(): Logger {
  const path = process.env.DSH_TUI_LOG
  if (path === undefined || path === '') {
    return { debug: () => {} }
  }
  void appendFile(path, `--- dsh-tui session ${new Date().toISOString()} ---\n`, 'utf8').catch(() => {})
  return {
    debug: (message: string): void => {
      void appendFile(path, `${new Date().toISOString()} ${message}\n`, 'utf8').catch(() => {})
    },
  }
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'

const CONSOLE_METHODS: readonly ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug', 'trace']

/**
 * Takes custody of process.stderr and the global console while the TUI owns
 * the screen. `restore` puts everything back and returns the captured stderr
 * text for replay after the alt screen exited.
 */
export class StderrCapture {
  private readonly originalWrite: typeof process.stderr.write
  private readonly originalConsole: Record<ConsoleMethod, (...args: unknown[]) => void>
  private captured = ''
  private active = false

  constructor(private readonly log: Logger) {
    this.originalWrite = process.stderr.write.bind(process.stderr)
    this.originalConsole = {} as Record<ConsoleMethod, (...args: unknown[]) => void>
    for (const method of CONSOLE_METHODS) {
      // Keep the function identity: restore assigns it back unchanged.
      this.originalConsole[method] = console[method] as (...args: unknown[]) => void
    }
  }

  install(): void {
    if (this.active) return
    this.active = true
    process.stderr.write = ((chunk: Uint8Array | string, ...rest: never[]): unknown => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      this.captured += text
      this.log.debug(`stderr: ${JSON.stringify(text)}`)
      const callback = rest[0] as (() => void) | undefined
      if (typeof callback === 'function') callback()
      return true
    }) as typeof process.stderr.write
    for (const method of CONSOLE_METHODS) {
      console[method] = (...args: unknown[]): void => {
        this.log.debug(`console.${method}: ${format(...args)}`)
      }
    }
  }

  restore(): string {
    if (!this.active) return ''
    this.active = false
    process.stderr.write = this.originalWrite
    for (const method of CONSOLE_METHODS) {
      console[method] = this.originalConsole[method]
    }
    const pending = this.captured
    this.captured = ''
    return pending
  }
}
