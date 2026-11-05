/**
 * The animated status segment of the header bar: shows a braille spinner
 * frame while work is in flight (a turn, maintenance, or a background subagent
 * — the driver's aggregate busy state), plain text otherwise. Owns its frame
 * timer, asks the host for re-renders on each tick, and reports the
 * visible/hidden flips so a terminal integration can mirror them.
 * @module dsh-tui/components/status-line
 */

import { truncateToWidth, type Component } from '@earendil-works/pi-tui'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

export class StatusLine implements Component {
  private text = ''
  private active = false
  private frame = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private cacheWidth: number | undefined
  private cacheLine: string[] | undefined
  private activeListener: ((active: boolean) => void) | undefined

  constructor(
    private readonly requestRender: () => void,
    private readonly intervalMs = 120,
    private readonly frames: readonly string[] = SPINNER_FRAMES,
  ) {}

  /**
   * Observe the spinner's visible/hidden flips — the exact state a terminal-side
   * observer can see (tab indicator, notification, sound), so an addon can
   * mirror it instead of scraping the byte stream for frames. Pass `undefined`
   * to detach. The flag mirrors the driver's aggregate busy state, so a visible
   * spinner never disagrees with what the OSC reports.
   */
  setOnActiveChange(listener: ((active: boolean) => void) | undefined): void {
    this.activeListener = listener
  }

  /** Update the static text and the running state together. */
  set(text: string, active: boolean): void {
    const textChanged = text !== this.text
    const stateChanged = active !== this.active
    if (!textChanged && !stateChanged) return
    this.text = text
    this.active = active
    this.cacheWidth = undefined
    this.cacheLine = undefined
    this.syncTimer()
    if (stateChanged) {
      this.requestRender()
      this.activeListener?.(this.active)
    }
  }

  dispose(): void {
    const wasActive = this.active
    this.active = false
    this.syncTimer()
    this.cacheWidth = undefined
    this.cacheLine = undefined
    if (wasActive) this.activeListener?.(false)
  }

  invalidate(): void {
    this.cacheWidth = undefined
    this.cacheLine = undefined
  }

  render(width: number): string[] {
    if (this.cacheLine !== undefined && this.cacheWidth === width) return this.cacheLine
    const head = this.active ? `${this.frames[this.frame % this.frames.length] ?? '·'} ` : ''
    this.cacheWidth = width
    this.cacheLine = [truncateToWidth(`${head}${this.text}`, width)]
    return this.cacheLine
  }

  private syncTimer(): void {
    if (this.active && this.timer === undefined) {
      this.timer = setInterval(() => {
        this.frame = (this.frame + 1) % this.frames.length
        this.cacheWidth = undefined
        this.cacheLine = undefined
        this.requestRender()
      }, this.intervalMs)
    } else if (!this.active && this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
}
