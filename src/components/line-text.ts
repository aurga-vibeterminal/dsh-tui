/**
 * One-line status text with a setter: truncate-to-width with caching, the
 * shape the header bar and composer hints need (TruncatedText is immutable).
 * @module dsh-tui/components/line-text
 */

import { truncateToWidth, type Component } from '@earendil-works/pi-tui'

export class LineText implements Component {
  private cacheWidth: number | undefined
  private cacheLine: string[] | undefined

  constructor(
    private text: string,
    private readonly paddingX = 0,
  ) {}

  setText(text: string): void {
    if (text === this.text) return
    this.text = text
    this.cacheWidth = undefined
    this.cacheLine = undefined
  }

  invalidate(): void {
    this.cacheWidth = undefined
    this.cacheLine = undefined
  }

  render(width: number): string[] {
    if (this.cacheLine !== undefined && this.cacheWidth === width) return this.cacheLine
    const pad = ' '.repeat(this.paddingX)
    const line = `${pad}${truncateToWidth(this.text, Math.max(0, width - this.paddingX * 2))}`
    this.cacheWidth = width
    this.cacheLine = [line]
    return this.cacheLine
  }
}
