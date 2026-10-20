/**
 * Transcript rendering: maps {@link TranscriptItem}s to lines with one
 * component per item, cached by a snapshot key of the item's renderable
 * content. The app invalidates and requests renders from model changes.
 * @module dsh-tui/components/transcript
 */

import {
  Markdown,
  Text,
  truncateToWidth,
  type Component,
  type MarkdownTheme,
} from '@earendil-works/pi-tui'
import type { Theme } from '../theme.ts'
import type { TranscriptItem } from '../events.ts'

/** Rendering dependencies shared by all item renderers. */
export interface ItemContext {
  readonly theme: Theme
  readonly markdownTheme: MarkdownTheme
}

interface Entry {
  key: string
  component: Component
}

export class TranscriptView implements Component {
  private readonly entries: Entry[] = []
  private cacheWidth: number | undefined
  private cacheLines: string[] | undefined

  constructor(
    private readonly items: readonly TranscriptItem[],
    private readonly context: ItemContext,
  ) {}

  invalidate(): void {
    this.cacheWidth = undefined
    this.cacheLines = undefined
  }

  render(width: number): string[] {
    if (this.cacheLines !== undefined && this.cacheWidth === width) return this.cacheLines
    const lines: string[] = []
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index]!
      const entry = this.entryAt(index, item)
      lines.push(...entry.component.render(width))
      const next = this.items[index + 1]
      if (next !== undefined && (next.kind === 'user' || next.kind === 'assistant')) lines.push('')
    }
    this.cacheWidth = width
    this.cacheLines = lines
    return lines
  }

  private entryAt(index: number, item: TranscriptItem): Entry {
    const key = snapshotKey(item)
    const existing = this.entries[index]
    if (existing !== undefined && existing.key === key) return existing
    const entry: Entry = { key, component: createItemComponent(item, this.context) }
    this.entries[index] = entry
    return entry
  }
}

/** Everything of the item its rendering depends on. */
function snapshotKey(item: TranscriptItem): string {
  switch (item.kind) {
    case 'user':
      return `user|${item.text}`
    case 'assistant':
      return `assistant|${item.live ? 'live' : 'set'}|${item.text}|${firstLine(item.reasoning, 72)}`
    case 'tool':
      return `tool|${item.name}|${item.argDigest}|${item.status}|${item.resultDigest ?? ''}`
    case 'notice':
      return `notice|${item.text}|${item.tone}`
  }
}

function createItemComponent(item: TranscriptItem, context: ItemContext): Component {
  const { theme, markdownTheme } = context
  switch (item.kind) {
    case 'user':
      return new Text(theme.user('❯ ') + item.text, 0, 0)
    case 'assistant': {
      const reasoning = item.reasoning === ''
        ? []
        : [theme.dim(`· ${item.live ? 'thinking… ' : ''}${firstLine(item.reasoning, 72)}`)]
      if (item.text === '') {
        return new Text(reasoning.length > 0 ? reasoning.join('\n') : (item.live ? theme.dim('…') : ''), 0, 0)
      }
      if (reasoning.length === 0) return new Markdown(item.text, 0, 0, markdownTheme)
      return new Compound([
        new Text(reasoning.join('\n'), 0, 0),
        new Markdown(item.text, 0, 0, markdownTheme),
      ])
    }
    case 'tool': {
      const glyph = item.status === 'running' ? '⋯' : item.status === 'ok' ? '✓' : '✕'
      const head = item.status === 'ok'
        ? theme.success(`${glyph} ${item.name}`)
        : item.status === 'error'
          ? theme.error(`${glyph} ${item.name}  ${item.argDigest}`)
          : theme.tool(`${glyph} ${item.name}  ${item.argDigest}`)
      const line = item.resultDigest === undefined
        ? head
        : `${head}${theme.dim(`  ${truncateToWidth(item.resultDigest, 60, '')}`)}`
      return new Text(line, 0, 0)
    }
    case 'notice':
      return new Text(item.tone === 'error' ? theme.error(item.text) : theme.dim(item.text), 0, 0)
  }
}

function firstLine(text: string, max: number): string {
  const line = text.split('\n').find(candidate => candidate.trim() !== '') ?? ''
  const trimmed = line.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Stacks child components vertically without layout semantics. */
class Compound implements Component {
  constructor(private readonly children: readonly Component[]) {}

  invalidate(): void {
    for (const child of this.children) child.invalidate()
  }

  render(width: number): string[] {
    const lines: string[] = []
    for (const child of this.children) lines.push(...child.render(width))
    return lines
  }
}
