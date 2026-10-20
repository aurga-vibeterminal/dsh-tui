/**
 * Dev logging and stderr custody.
 *
 * While the TUI owns the screen, stray writes to process.stderr would garble
 * the alt-screen viewport, so the app installs a capture that tees stderr
 * into the debug log file. Our own debug lines also go there; the file is
 * enabled through DSH_TUI_LOG=<path>.
 */

import { appendFile } from 'node:fs/promises'
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

/**
 * Replace process.stderr writes while the TUI owns the screen: lines are
 * appended to `log` instead of the terminal. `restore` puts the original
 * stream back and flushes pending lines to the real stderr when asked.
 */
export class StderrCapture {
  private readonly original: typeof process.stderr.write
  private captured = ''
  private active = false

  constructor(private readonly log: Logger) {
    this.original = process.stderr.write.bind(process.stderr)
  }

  install(): void {
    if (this.active) return
    this.active = true
    process.stderr.write = ((chunk: Uint8Array | string, ...rest: never[]): unknown => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      this.captured += text
      this.log.debug(`stderr: ${JSON.stringify(text)}`)
      // Keep the callback contract of the original stream.
      const callback = rest[0] as (() => void) | undefined
      if (typeof callback === 'function') callback()
      return true
    }) as typeof process.stderr.write
  }

  restore(): string {
    if (!this.active) return ''
    this.active = false
    process.stderr.write = this.original
    const pending = this.captured
    this.captured = ''
    return pending
  }
}
