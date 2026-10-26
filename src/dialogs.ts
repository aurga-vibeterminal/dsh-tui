/**
 * Interaction dialogs: the two waterfall answerers the TUI owes the runtime —
 * tool approvals (`approval/request`) and user questions
 * (`user-questions/request`, the `ask_user_question` tool).
 *
 * Both are plain pi-tui components shown as focused overlays above the app
 * layout; key handlers resolve the waterfall promise, and the request's
 * AbortSignal resolves cancellation without input.
 * @module dsh-tui/dialogs
 */

import {
  Key,
  matchesKey,
  SelectList,
  truncateToWidth,
  visibleWidth,
  type Component,
  type SelectListTheme,
} from '@earendil-works/pi-tui'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
} from '@deepseek-ai/dsh-user-questions/types'
import type { Theme } from './theme.ts'
import { selectListThemeFor } from './theme.ts'
import { t } from './i18n.ts'

/** Present the localized display reason best matching the environment. */
function displayReasonOf(reasons: { en: string, readonly [locale: string]: string } | undefined, fallback: string | undefined): string {
  if (reasons !== undefined) return reasons.en
  return fallback ?? ''
}

/** One pending decision shown to the user. */
export interface ApprovalRequest {
  toolName: string
  reason?: string | undefined
  displayReason?: { en: string, readonly [locale: string]: string } | undefined
  signal?: AbortSignal | undefined
}

export class ApprovalDialog implements Component {
  private cacheWidth: number | undefined
  private cacheLines: string[] | undefined
  private settled = false

  readonly done: Promise<ApprovalOutcome>
  private resolveDone!: (outcome: ApprovalOutcome) => void

  constructor(private readonly request: ApprovalRequest, private readonly theme: Theme) {
    this.done = new Promise<ApprovalOutcome>((resolve) => {
      this.resolveDone = resolve
    })
    request.signal?.addEventListener('abort', () => {
      this.settle('cancelled')
    }, { once: true })
  }

  invalidate(): void {
    this.cacheWidth = undefined
    this.cacheLines = undefined
  }

  render(width: number): string[] {
    if (this.cacheLines !== undefined && this.cacheWidth === width) return this.cacheLines
    const reason = displayReasonOf(this.request.displayReason, this.request.reason)
    const head = this.theme.warning(t('approval.title', { tool: this.request.toolName }))
    const lines = [truncateToWidth(` ${head}`, width)]
    if (reason !== '') {
      lines.push(truncateToWidth(this.theme.dim(`  ${reason}`), width))
    }
    lines.push(truncateToWidth(this.theme.dim(t('approval.hint')), width))
    this.cacheWidth = width
    this.cacheLines = lines
    return lines
  }

  handleInput(data: string): void {
    if (this.settled) return
    if (matchesKey(data, Key.enter) || data === 'y' || data === 'Y') {
      this.settle('allowed-once')
      return
    }
    if (matchesKey(data, Key.escape) || data === 'n' || data === 'N') {
      this.settle('rejected')
      return
    }
    if (matchesKey(data, Key.ctrl('c'))) {
      this.settle('cancelled')
    }
  }

  private settle(outcome: ApprovalOutcome): void {
    if (this.settled) return
    this.settled = true
    this.resolveDone(outcome)
  }
}

/** One pending question batch shown to the user. */
export interface QuestionRequest {
  questions: readonly AskUserQuestionItem[]
  signal?: AbortSignal | undefined
}

interface QuestionState {
  readonly question: AskUserQuestionItem
  readonly selected: Set<string>
  cursor: number
}

export class QuestionDialog implements Component {
  private readonly states: QuestionState[] = []
  private index = 0
  private cacheWidth: number | undefined
  private cacheLines: string[] | undefined
  private settled = false

  readonly done: Promise<AskUserQuestionAnswer>
  private resolveDone!: (answer: AskUserQuestionAnswer) => void

  constructor(private readonly request: QuestionRequest, private readonly theme: Theme) {
    this.done = new Promise<AskUserQuestionAnswer>((resolve) => {
      this.resolveDone = resolve
    })
    for (const question of request.questions) {
      this.states.push({ question, selected: new Set<string>(), cursor: 0 })
    }
    request.signal?.addEventListener('abort', () => {
      this.settle({ answers: [] })
    }, { once: true })
  }

  invalidate(): void {
    this.cacheWidth = undefined
    this.cacheLines = undefined
  }

  render(width: number): string[] {
    if (this.cacheLines !== undefined && this.cacheWidth === width) return this.cacheLines
    const lines: string[] = []
    const active = this.states[this.index]
    if (active !== undefined) {
      const marker = this.theme.accent('?')
      lines.push(truncateToWidth(` ${marker} ${active.question.question}`, width))
      if (active.question.detail !== undefined && active.question.detail !== '') {
        for (const line of active.question.detail.split('\n').slice(0, 8)) {
          lines.push(truncateToWidth(this.theme.dim(`   ${line}`), width))
        }
      }
      const options = active.question.options ?? []
      for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
        const option = options[optionIndex]!
        const isCursor = optionIndex === active.cursor
        const isSelected = active.selected.has(option.label)
        const prefix = isCursor ? ' ▶ ' : '   '
        const mark = active.question.multiSelect === true ? (isSelected ? '[x] ' : '[ ] ') : ''
        const label = isCursor ? this.theme.accent(option.label) : option.label
        lines.push(truncateToWidth(`${prefix}${mark}${label}`, width))
      }
      const navigation = this.states.length > 1
        ? t('question.nav', { index: String(this.index + 1), total: String(this.states.length) })
        : ''
      const hints = active.question.multiSelect === true
        ? t('question.hintMulti', { nav: navigation })
        : t('question.hintSingle', { nav: navigation })
      lines.push(truncateToWidth(this.theme.dim(hints), width))
    }
    this.cacheWidth = width
    this.cacheLines = lines
    return lines
  }

  handleInput(data: string): void {
    if (this.settled) return
    const active = this.states[this.index]
    if (active === undefined) return
    const options = active.question.options ?? []

    if (matchesKey(data, Key.escape)) {
      this.settle({ answers: [] })
      return
    }
    if (matchesKey(data, Key.up)) {
      active.cursor = active.cursor > 0 ? active.cursor - 1 : options.length - 1
      this.invalidate()
      return
    }
    if (matchesKey(data, Key.down)) {
      active.cursor = active.cursor < options.length - 1 ? active.cursor + 1 : 0
      this.invalidate()
      return
    }
    if (matchesKey(data, Key.tab)) {
      this.index = (this.index + 1) % this.states.length
      this.invalidate()
      return
    }
    if (matchesKey(data, Key.space) && active.question.multiSelect === true && options.length > 0) {
      const label = options[active.cursor]?.label
      if (label !== undefined) {
        if (active.selected.has(label)) active.selected.delete(label)
        else active.selected.add(label)
        this.invalidate()
      }
      return
    }
    if (matchesKey(data, Key.enter)) {
      if (active.question.multiSelect !== true && options.length > 0) {
        const label = options[active.cursor]?.label
        if (label !== undefined) active.selected.add(label)
      }
      // Advance; submitting past the last question settles the batch.
      if (this.index < this.states.length - 1) {
        this.index += 1
        this.invalidate()
        return
      }
      const answers: AskUserQuestionAnswerItem[] = this.states.map(state => ({
        id: state.question.id,
        selected: [...state.selected],
      }))
      this.settle({ answers })
    }
  }

  private settle(answer: AskUserQuestionAnswer): void {
    if (this.settled) return
    this.settled = true
    this.resolveDone(answer)
  }
}

/** Clamp helper kept for future bordered dialogs. */
export function padLine(line: string, width: number): string {
  const visible = visibleWidth(line)
  return visible >= width ? line : line + ' '.repeat(width - visible)
}

/**
 * Scrollable single-select picker over the pi-tui SelectList: pagination and
 * mouse support come from the list; the wrapper adds a title, hints, and a
 * `done` promise resolved with the chosen value.
 */
export class PickerDialog implements Component {
  private readonly list: SelectList
  private settled = false
  private cacheWidth: number | undefined
  private cacheLines: string[] | undefined

  readonly done: Promise<string | undefined>
  private resolveDone!: (value: string | undefined) => void

  constructor(
    private readonly title: string,
    items: readonly { value: string, label: string, description?: string }[],
    private readonly theme: Theme,
    private readonly hints: string,
    maxVisible = 12,
  ) {
    this.list = new SelectList(
      items.map(item => ({
        value: item.value,
        label: item.label,
        ...(item.description === undefined ? {} : { description: item.description }),
      })),
      maxVisible,
      selectListThemeFor(theme),
    )
    this.done = new Promise<string | undefined>((resolve) => {
      this.resolveDone = resolve
    })
    this.list.onSelect = (item) => {
      if (this.settled) return
      this.settled = true
      this.resolveDone(item.value)
    }
    this.list.onCancel = () => {
      if (this.settled) return
      this.settled = true
      this.resolveDone(undefined)
    }
  }

  invalidate(): void {
    this.list.invalidate()
  }

  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  render(width: number): string[] {
    if (this.cacheLines !== undefined && this.cacheWidth === width) return this.cacheLines
    const lines = [truncateToWidth(this.theme.accent(` ${this.title}`), width)]
    for (const line of this.list.render(width - 2)) lines.push(truncateToWidth(` ${line}`, width))
    lines.push(truncateToWidth(this.theme.dim(` ${this.hints}`), width))
    this.cacheWidth = width
    this.cacheLines = lines
    return lines
  }

  private settledGetterUnused(): void {}
}

/** Generic read-only list overlay (todos, exports, static info). */
export class ListDialog implements Component {
  private cacheWidth: number | undefined
  private cacheLines: string[] | undefined
  private settled = false

  readonly done: Promise<void>
  private resolveDone!: () => void

  constructor(
    private readonly title: string,
    private readonly rows: readonly string[],
    private readonly theme: Theme,
  ) {
    this.done = new Promise<void>((resolve) => {
      this.resolveDone = resolve
    })
  }

  invalidate(): void {
    this.cacheWidth = undefined
    this.cacheLines = undefined
  }

  render(width: number): string[] {
    if (this.cacheLines !== undefined && this.cacheWidth === width) return this.cacheLines
    const lines = [truncateToWidth(this.theme.accent(` ${this.title}`), width)]
    for (const row of this.rows) lines.push(truncateToWidth(row, width))
    lines.push(truncateToWidth(this.theme.dim(t('dialog.closeHint')), width))
    this.cacheWidth = width
    this.cacheLines = lines
    return lines
  }

  handleInput(data: string): void {
    if (this.settled) return
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === 'q') {
      this.settled = true
      this.resolveDone()
    }
  }
}

/** Read-only raw-event inspector shown by the /events command. */
export class EventsDialog implements Component {
  private cacheWidth: number | undefined
  private cacheLines: string[] | undefined
  private settled = false

  readonly done: Promise<void>
  private resolveDone!: () => void

  constructor(
    private readonly records: readonly { seq: number, type: string, summary: string }[],
    private readonly theme: Theme,
    private readonly maxLines = 24,
  ) {
    this.done = new Promise<void>((resolve) => {
      this.resolveDone = resolve
    })
  }

  invalidate(): void {
    this.cacheWidth = undefined
    this.cacheLines = undefined
  }

  render(width: number): string[] {
    if (this.cacheLines !== undefined && this.cacheWidth === width) return this.cacheLines
    const lines = [truncateToWidth(this.theme.accent(` ${t('events.title', { shown: String(Math.min(this.maxLines, this.records.length)), total: String(this.records.length) })}`), width)]
    const start = Math.max(0, this.records.length - this.maxLines)
    for (const record of this.records.slice(start)) {
      lines.push(truncateToWidth(this.theme.dim(` ${String(record.seq).padStart(4, ' ')} ${record.type} ${record.summary}`), width))
    }
    lines.push(truncateToWidth(this.theme.dim(t('dialog.closeHint')), width))
    this.cacheWidth = width
    this.cacheLines = lines
    return lines
  }

  handleInput(data: string): void {
    if (this.settled) return
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === 'q') {
      this.settled = true
      this.resolveDone()
    }
  }
}
