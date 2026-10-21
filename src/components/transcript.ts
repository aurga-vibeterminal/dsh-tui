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
  visibleWidth,
  type Component,
  type MarkdownTheme,
} from '@earendil-works/pi-tui'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
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
  private context: ItemContext

  constructor(
    private readonly items: readonly TranscriptItem[],
    context: ItemContext,
  ) {
    this.context = context
  }

  invalidate(): void {
    this.cacheWidth = undefined
    this.cacheLines = undefined
  }

  /** Swap the rendering context (theme switch) and drop all caches. */
  setContext(context: ItemContext): void {
    this.context = context
    this.entries.length = 0
    this.invalidate()
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
      return `tool|${item.name}|${item.argDigest}|${item.status}|${item.resultDigest ?? ''}|${String(item.expanded)}`
    case 'notice':
      return `notice|${item.text}|${item.tone}`
  }
}

/** Compact headline for a tool item, preferring the declared call view title. */
function toolHeadline(item: Extract<TranscriptItem, { kind: 'tool' }>): { title: string, kind: string | undefined } {
  const view = item.resultView !== undefined ? viewTitle(item.resultView) : undefined
  const callTitle = item.callView !== undefined ? callViewTitle(item.callView) : undefined
  const title = view ?? callTitle ?? `${item.name} ${item.argDigest}`
  const kind = item.callView !== undefined && 'kind' in item.callView ? item.callView.kind : undefined
  return { title, kind }
}

function callViewTitle(view: ToolCallView): string | undefined {
  switch (view.card) {
    case 'terminal': return view.title
    case 'diff': return view.title
    case 'generic': return view.title
  }
}

function viewTitle(view: ToolResultView): string | undefined {
  switch (view.card) {
    case 'generic': return view.title
    case 'terminal': return view.title
    case 'diff': return view.title
    case 'search': return view.title
    case 'read': return undefined
    case 'web': return view.title
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
      const headline = toolHeadline(item)
      const head = item.status === 'ok'
        ? theme.success(`${glyph} ${headline.title}`)
        : item.status === 'error'
          ? theme.error(`${glyph} ${headline.title}`)
          : theme.tool(`${glyph} ${headline.title}`)
      const hint = item.expanded ? '' : theme.dim(' · ctrl+o')
      const header = new Text(`${head}${hint}`, 0, 0)
      if (!item.expanded) return header
      return new Compound([header, ...detailComponents(item, context)])
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

/** The expanded detail block components for one tool item. */
function detailComponents(item: Extract<TranscriptItem, { kind: 'tool' }>, context: ItemContext): Component[] {
  const { theme } = context
  const blocks: Component[] = []
  const view = item.resultView ?? item.callView
  if (view === undefined) {
    // No declared view: show the result digest and raw args.
    if (item.resultDigest !== undefined) blocks.push(new Text(theme.dim(`  ${item.resultDigest}`), 0, 0))
    if (item.rawArgs !== '' && item.rawArgs !== '{}') {
      blocks.push(new Text(theme.dim(`  args ${truncateToWidth(item.rawArgs, 200, '')}`), 0, 0))
    }
    return blocks
  }
  switch (view.card) {
    case 'diff': {
      for (const diff of view.diffs) blocks.push(diffComponent(diff.path, diff.oldText, diff.newText, theme))
      return blocks
    }
    case 'read': {
      blocks.push(new Text(theme.dim(`  ${view.path}${view.totalLines === undefined ? '' : ` (${String(view.lines.length)}/${String(view.totalLines)} lines)`}`), 0, 0))
      const width = 4 + Math.max(...view.lines.map(line => String(line.number).length), 1)
      for (const line of view.lines.slice(0, 200)) {
        const number = theme.dim(`${String(line.number).padStart(width)} │ `)
        blocks.push(new Text(`${number}${line.text}`, 0, 0))
      }
      return blocks
    }
    case 'terminal': {
      if (view.card === 'terminal' && 'output' in view && view.output !== undefined && view.output !== '') {
        for (const line of view.output.replace(/\r\n/g, '\n').split('\n').slice(0, 100)) {
          blocks.push(new Text(theme.dim(`  ${line}`), 0, 0))
        }
      }
      const terminal = view as { exitCode?: number, signal?: string }
      if (terminal.exitCode !== undefined && terminal.exitCode !== 0) {
        blocks.push(new Text(theme.error(`  exit ${String(terminal.exitCode)}`), 0, 0))
      } else if (terminal.signal !== undefined) {
        blocks.push(new Text(theme.warning(`  signal ${terminal.signal}`), 0, 0))
      }
      return blocks
    }
    case 'search': {
      if (view.shape === 'paths') {
        blocks.push(new Text(theme.dim(`  ${String(view.paths.length)} path(s)${view.truncated ? ` of ${String(view.total)} (capped)` : ''}`), 0, 0))
        for (const path of view.paths.slice(0, 100)) blocks.push(new Text(theme.tool(`  ${path}`), 0, 0))
      } else {
        blocks.push(new Text(theme.dim(`  ${String(view.total)} match(es)${view.truncated ? ' (capped)' : ''}`), 0, 0))
        for (const file of view.files.slice(0, 30)) {
          blocks.push(new Text(theme.tool(`  ${file.path}`), 0, 0))
          for (const match of file.matches.slice(0, 10)) {
            blocks.push(new Text(theme.dim(`   ${String(match.lineNumber).padStart(4)} ${truncateToWidth(match.line, 120, '')}`), 0, 0))
          }
        }
      }
      return blocks
    }
    case 'generic': {
      if ('content' in view && view.content !== undefined) {
        for (const block of view.content.slice(0, 20)) {
          if (block.type === 'text' && block.text !== '') {
            for (const line of block.text.split('\n').slice(0, 40)) blocks.push(new Text(theme.dim(`  ${line}`), 0, 0))
          }
        }
      }
      if ('rawInput' in view && view.rawInput !== undefined) {
        const rendered = typeof view.rawInput === 'string' ? view.rawInput : JSON.stringify(view.rawInput, null, 2)
        if (rendered !== '' && rendered !== '{}') {
          blocks.push(new Text(theme.dim(`  in ${truncateToWidth(rendered, 200, '')}`), 0, 0))
        }
      }
      return blocks
    }
    case 'web': {
      if ('content' in view && Array.isArray(view.content)) {
        for (const block of (view.content as { type: string, text?: string }[]).slice(0, 20)) {
          if (block.type === 'text' && block.text !== undefined) {
            for (const line of block.text.split('\n').slice(0, 40)) blocks.push(new Text(theme.dim(`  ${line}`), 0, 0))
          }
        }
      }
      return blocks
    }
  }
}

/** One unified-diff block with +/- coloring (LCS over lines, size-guarded). */
function diffComponent(path: string, oldText: string | null, newText: string, theme: Theme): Component {
  const lines = diffLines(oldText, newText)
  const rows: string[] = [theme.accent(`  ── ${path} ──`)]
  for (const line of lines.slice(0, 200)) {
    if (line.op === '+') rows.push(theme.success(`  + ${line.text}`))
    else if (line.op === '-') rows.push(theme.error(`  - ${line.text}`))
    else rows.push(theme.dim(`    ${line.text}`))
  }
  if (lines.length > 200) rows.push(theme.dim(`  … ${String(lines.length - 200)} more line(s)`))
  return new Text(rows.join('\n'), 0, 0)
}

interface DiffOp { op: '+' | '-' | ' ', text: string }

/** Common-prefix/suffix trim + LCS middle; falls back to before/after beyond the guard. */
function diffLines(oldText: string | null, newText: string): DiffOp[] {
  const oldLines = oldText === null ? [] : oldText.replace(/\r\n/g, '\n').split('\n')
  const newLines = newText.replace(/\r\n/g, '\n').split('\n')
  // Drop the shared trailing empty entry from final newlines.
  if (oldLines.length > 0 && oldLines.at(-1) === '') oldLines.pop()
  if (newLines.length > 0 && newLines.at(-1) === '') newLines.pop()

  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1
  let endOld = oldLines.length
  let endNew = newLines.length
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld -= 1
    endNew -= 1
  }
  const result: DiffOp[] = []
  for (let index = 0; index < start; index += 1) result.push({ op: ' ', text: oldLines[index]! })
  const middleOld = oldLines.slice(start, endOld)
  const middleNew = newLines.slice(start, endNew)
  if (middleOld.length * middleNew.length > 250_000) {
    for (const text of middleOld) result.push({ op: '-', text })
    for (const text of middleNew) result.push({ op: '+', text })
  } else {
    result.push(...lcsDiff(middleOld, middleNew))
  }
  for (let index = endOld; index < oldLines.length; index += 1) result.push({ op: ' ', text: oldLines[index]! })
  return result
}

/** Classic LCS line diff for bounded middles. */
function lcsDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const oldCount = oldLines.length
  const newCount = newLines.length
  const table: number[][] = Array.from({ length: oldCount + 1 }, () => new Array<number>(newCount + 1).fill(0))
  for (let i = oldCount - 1; i >= 0; i -= 1) {
    for (let j = newCount - 1; j >= 0; j -= 1) {
      table[i]![j] = oldLines[i] === newLines[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const result: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < oldCount && j < newCount) {
    if (oldLines[i] === newLines[j]) {
      result.push({ op: ' ', text: oldLines[i]! })
      i += 1
      j += 1
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      result.push({ op: '-', text: oldLines[i]! })
      i += 1
    } else {
      result.push({ op: '+', text: newLines[j]! })
      j += 1
    }
  }
  while (i < oldCount) {
    result.push({ op: '-', text: oldLines[i]! })
    i += 1
  }
  while (j < newCount) {
    result.push({ op: '+', text: newLines[j]! })
    j += 1
  }
  return result
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
