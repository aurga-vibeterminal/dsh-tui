import { Terminal as XTerm } from '@xterm/headless'
import type { ProgramStatus, Terminal } from '@earendil-works/pi-tui'

/**
 * A pi-tui `Terminal` backed by a headless xterm emulator. Every method routes
 * through the same byte sequences `ProcessTerminal` writes, so tests observe
 * exactly what a real terminal would parse — including cursor moves, clears,
 * synchronized output, and scrollback.
 */
export class HeadlessTerminal implements Terminal {
  private readonly xterm: XTerm
  private inputHandler: ((data: string) => void) | undefined
  private resizeHandler: (() => void) | undefined
  private pendingWrites = 0

  constructor(cols = 80, rows = 24, scrollback = 5000) {
    this.xterm = new XTerm({ cols, rows, scrollback, allowProposedApi: true })
  }

  // -- pi-tui Terminal ----------------------------------------------------

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput
    this.resizeHandler = onResize
  }

  stop(): void {
    this.inputHandler = undefined
    this.resizeHandler = undefined
  }

  write(data: string): void {
    // xterm parses writes asynchronously; track completion so tests can await
    // settled() before reading the buffer.
    this.pendingWrites += 1
    this.xterm.write(data, () => {
      this.pendingWrites -= 1
    })
  }

  get columns(): number {
    return this.xterm.cols
  }

  get rows(): number {
    return this.xterm.rows
  }

  get kittyProtocolActive(): boolean {
    return false
  }

  get modifyOtherKeysActive(): boolean {
    return false
  }

  moveBy(lines: number): void {
    if (lines > 0) this.xterm.write(`\x1b[${lines}B`)
    else if (lines < 0) this.xterm.write(`\x1b[${-lines}A`)
  }

  hideCursor(): void {
    this.xterm.write('\x1b[?25l')
  }

  showCursor(): void {
    this.xterm.write('\x1b[?25h')
  }

  clearLine(): void {
    this.xterm.write('\x1b[K')
  }

  clearFromCursor(): void {
    this.xterm.write('\x1b[J')
  }

  clearScreen(): void {
    this.xterm.write('\x1b[2J\x1b[H')
  }

  setTitle(title: string): void {
    this.xterm.write(`\x1b]0;${title}\x07`)
  }

  setProgress(_active: boolean): void {
    // OSC 9;4 progress is ignored by the emulator.
  }

  async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {
    // No real input stream to wait for; escape sequences arrive synchronously.
  }

  setProgramStatus(_status: ProgramStatus): void {
    // ConEmu-style program status sequences are ignored by the emulator.
  }

  // -- test API ------------------------------------------------------------

  /** Resolve once every queued write has been parsed by the emulator. */
  async settled(): Promise<void> {
    while (this.pendingWrites > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 1))
    }
  }

  /** Feed bytes as if typed into the terminal. */
  send(data: string): void {
    this.inputHandler?.(data)
  }

  /** Resize the emulator and notify the TUI. */
  resizeTo(columns: number, rows: number): void {
    this.xterm.resize(columns, rows)
    this.resizeHandler?.()
  }

  /** The emulator's active buffer type: "normal" or "alternate". */
  get bufferType(): 'normal' | 'alternate' {
    return this.xterm.buffer.active.type
  }

  /** Trimmed text of one absolute buffer row (scrollback + viewport). */
  line(row: number): string {
    const line = this.xterm.buffer.active.getLine(row)
    return line === undefined ? '' : line.translateToString(true)
  }

  /** Every buffer row written so far, in order. */
  textLines(): string[] {
    const buffer = this.xterm.buffer.active
    const rows: string[] = []
    for (let index = 0; index < buffer.length; index += 1) {
      rows.push(this.line(index))
    }
    return rows
  }

  /** Index of the first row containing `needle`, or -1. */
  find(needle: string): number {
    return this.textLines().findIndex(row => row.includes(needle))
  }

  /** Index of the first *viewport* row containing `needle`, or -1. */
  findInView(needle: string): number {
    const buffer = this.xterm.buffer.active
    for (let row = buffer.baseY; row < buffer.baseY + this.xterm.rows; row += 1) {
      if (this.line(row).includes(needle)) return row
    }
    return -1
  }

  /** The emulator's full cursor row (viewport-relative). */
  get cursorRow(): number {
    return this.xterm.buffer.active.cursorY + this.xterm.buffer.active.baseY
  }
}
