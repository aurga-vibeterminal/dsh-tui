/**
 * The interactive application: opencode-style fullscreen layout over the
 * {@link AgentDriver} and {@link TranscriptModel}.
 *
 * ┌──────────────────────────────────────────┐
 * │ header: project · title · model · status │
 * ├──────────────────────────────────────────┤
 * │ transcript ScrollView (follow: end)      │
 * ├──────────────────────────────────────────┤
 * │ composer: bordered editor + hints        │
 * └──────────────────────────────────────────┘
 *
 * Keys: Enter sends (queues while running) · Esc/Ctrl+C interrupt · Ctrl+C
 * twice or Ctrl+Q quits. Exit restores the main screen, prints the transcript
 * into normal scrollback, flushes the session, and leaves through appExit.
 * @module dsh-tui/app
 */

import { basename } from 'node:path'
import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import {
  CombinedAutocompleteProvider,
  Editor,
  isViewportTUI,
  Key,
  matchesKey,
  ProcessTerminal,
  ScrollView,
  TuiAltScreen,
  VStack,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type Component,
} from '@earendil-works/pi-tui'
import type {} from '@deepseek-ai/dsh-commands'
import { createDriver, createToolPresenter, type AgentDriver, type DriverModelRoute } from './agent-driver.ts'
import { fuzzyFileItems, resolveFdPath } from './components/file-search.ts'
import { TranscriptModel, type TranscriptItem } from './events.ts'
import { TranscriptView, type ItemContext } from './components/transcript.ts'
import { LineText } from './components/line-text.ts'
import { ApprovalDialog, EventsDialog, ListDialog, QuestionDialog } from './dialogs.ts'
import { StatusLine } from './components/status-line.ts'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { THEME_NAMES, markdownThemeFor, selectListThemeFor, themeByName, type Theme } from './theme.ts'
import { writeFile } from 'node:fs/promises'
import { availableLocales, initSystemLocale, knownLocales, locale, setLocale, t } from './i18n.ts'
import { createDebugLogger, StderrCapture, type Logger } from './util/log.ts'
import packageInfo from '../package.json'

export interface AppOptions {
  resume: string | undefined
  model: DriverModelRoute | undefined
  theme: string | undefined
  /** Startup prompt sent immediately after boot. */
  prompt: string | undefined
}

export interface AppResult {
  exitCode: number
}

/** Assembly and lifecycle of the fullscreen session. */
/**
 * Wraps the combined autocomplete provider so an empty/blank composer never
 * offers suggestions: deleting the leading "/" must close the command list,
 * not fall through to the base-path file listing. Forced (Tab) completion is
 * unaffected.
 */
class ComposerAutocomplete implements AutocompleteProvider {
  constructor(
    private readonly inner: CombinedAutocompleteProvider,
    private readonly basePath: string,
    private readonly fdPath: string | null,
  ) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal, force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const before = (lines[cursorLine] ?? '').slice(0, cursorCol)
    if (before.trim() === '' && options.force !== true) return null
    // pi-tui's @ fuzzy search silently returns nothing without the fd binary;
    // answer the @ branch from our bounded walk instead.
    if (this.fdPath === null) {
      const atToken = tokenAfterSeparators(before)
      if (atToken !== null && atToken.startsWith('@') && !atToken.startsWith('@"')) {
        const items = fuzzyFileItems(this.basePath, atToken)
        if (items.length === 0) return null
        return { items, prefix: atToken }
      }
    }
    return await this.inner.getSuggestions(lines, cursorLine, cursorCol, options)
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[], cursorLine: number, cursorCol: number } {
    return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
  }
}

/** The last separator-delimited token, or null when none precedes the cursor. */
function tokenAfterSeparators(before: string): string | null {
  const match = /([^\s,;:（）「」【】、，。；：'"=]+)$/.exec(before)
  return match === null ? null : match[1]!
}

export class TuiApp {
  private constructor(
    private readonly ctx: Context,
    private driver: AgentDriver,
    private readonly tui: TuiAltScreen,
    private readonly stderr: StderrCapture,
    private readonly transcript: TranscriptView,
    private readonly header: StatusLine,
    private readonly hints: LineText,
    private readonly editor: Editor,
    private theme: Theme,
    private themeRef: { current: Theme },
    private itemContext: ItemContext,
    private readonly log: Logger,
    private readonly disposers: Array<() => void>,
  ) {}

  /**
   * Build the app: driver first (its subscription feeds the model), then the
   * layout, then input handling.
   */
  static async create(ctx: Context, options: AppOptions): Promise<TuiApp> {
    initSystemLocale()
    const theme = themeByName(options.theme)
    const themeRef: { current: Theme } = { current: theme }
    const log = createDebugLogger()
    const model = new TranscriptModel(createToolPresenter(ctx))
    const driver = await createDriver(ctx, model, { resume: options.resume, model: options.model })

    const stderr = new StderrCapture(log)
    stderr.install()

    const tui = new TuiAltScreen(new ProcessTerminal(), false, undefined, {
      // Clickable "jump to bottom" pill shown while the transcript is scrolled
      // away from the end; localized and re-skinned with the live theme.
      scrollToEndIndicator: () => themeRef.current.accent(t('scroll.jumpToEnd')),
    })
    const itemContext: ItemContext = { theme, markdownTheme: markdownThemeFor(theme) }

    const header = new StatusLine(() => {
      tui.requestRender()
    }, 120, process.env.DSH_TUI_NO_SPINNER === '1' ? ['·'] : undefined)
    const transcript = new TranscriptView(model.items, itemContext)
    const hints = new LineText('', 1)
    const editor = new Editor(tui, {
      borderColor: theme.border,
      selectList: selectListThemeFor(theme),
    })
    const composer = new VStack([editor, hints])

    const scroll = new ScrollView(transcript, {
      follow: 'end',
      primary: true,
      overscroll: 'chain',
      scrollbar: 'auto',
      scrollbarHideDelayMs: 1500,
    })
    if (isViewportTUI(tui)) {
      tui.setLayoutRoot(new VStack([
        { component: scroll, basis: 0, grow: 1, minSize: 1 },
        { component: header, basis: 'auto', minSize: 1 },
        { component: composer, basis: 'auto', shrink: 1, minSize: 1 },
      ]))
    }
    tui.setFocus(editor)

    const app = new TuiApp(ctx, driver, tui, stderr, transcript, header, hints, editor, theme, themeRef, itemContext, log, [])
    app.wire(model)
    app.wireInteractions(ctx)
    app.wireCommands()
    pushWelcome(model, driver)
    return app
  }

  /** Overlay picker over pending inbox input; selecting removes the message. */
  private async pickInboxMessage(): Promise<void> {
    const pending = this.driver.inbox()
    if (pending.length === 0) {
      this.driver.model.pushNotice('· inbox empty')
      return
    }
    const labels = new Map<string, { id: string }>()
    const options = pending.map(entry => {
      const label = `[${entry.target}] ${truncate(entry.text === '' ? '(no text)' : entry.text, 44)}`
      labels.set(label, { id: entry.id })
      return { label }
    })
    const dialog = new QuestionDialog({
      questions: [{ id: 'inbox', question: t('dialog.inboxTitle'), options }],
    }, this.theme)
    const answer = await this.showDialog(dialog)
    const selected = answer.answers[0]?.selected[0]
    if (selected === undefined) {
      this.driver.model.pushNotice('· inbox picker cancelled')
      return
    }
    const target = labels.get(selected)
    if (target === undefined) return
    this.driver.model.pushNotice(this.driver.removeInboxMessage(target.id)
      ? `· removed ${truncate(selected, 60)}`
      : `· remove failed (already claimed?)`)
  }

  /** Fork the current session and switch the driver onto the child. */
  private async forkSession(): Promise<void> {
    if (this.driver.running) {
      this.driver.model.pushNotice('· interrupt the running turn first (esc)')
      return
    }
    let childId: string
    try {
      childId = await this.driver.forkCurrent()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.driver.model.pushNotice(`· fork failed: ${message.slice(0, 140)}`, 'error')
      return
    }
    await this.switchSession(childId)
  }

  /** Overlay with the current todo list. */
  private async showTodoList(): Promise<void> {
    const todos = this.driver.model.todos
    if (todos === undefined || todos.length === 0) {
      this.driver.model.pushNotice('· no todos recorded')
      return
    }
    const rows = todos.map(entry => {
      const mark = entry.status === 'completed' ? '☑' : entry.status === 'in_progress' ? '◐' : '☐'
      const styled = entry.status === 'completed'
        ? this.theme.dim(` ${mark} ${entry.content}`)
        : entry.status === 'in_progress'
          ? this.theme.accent(` ${mark} ${entry.content}`)
          : ` ${mark} ${entry.content}`
      return styled
    })
    await this.showDialog(new ListDialog('todos', rows, this.theme))
  }

  /** Theme picker + live re-skin of every rendered surface. */
  private async pickTheme(argument: string): Promise<void> {
    if (argument !== '') {
      this.applyTheme(argument)
      return
    }
    const dialog = new QuestionDialog({
      questions: [{
        id: 'theme',
        question: t('dialog.themeTitle'),
        options: THEME_NAMES.map(name => ({ label: name })),
      }],
    }, this.theme)
    const answer = await this.showDialog(dialog)
    const selected = answer.answers[0]?.selected[0]
    if (selected === undefined) {
      this.driver.model.pushNotice('· theme picker cancelled')
      return
    }
    this.applyTheme(selected)
  }

  private applyTheme(name: string): void {
    const next = themeByName(name)
    if (next === this.theme) {
      this.driver.model.pushNotice(t('notice.themeStays', { name }))
      return
    }
    this.theme = next
    this.themeRef.current = next
    this.itemContext = { theme: next, markdownTheme: markdownThemeFor(next) }
    this.transcript.setContext(this.itemContext)
    this.editor.borderColor = next.border
    this.driver.model.pushNotice(t('notice.themeChanged', { name }))
    this.tui.requestRender()
  }

  /** Export the transcript as Markdown. */
  private async exportTranscript(pathArgument: string): Promise<void> {
    const model = this.driver.model
    const sessionId = this.driver.hasAgent ? String(this.driver.session?.id ?? 'session') : 'unstarted'
    const path = pathArgument === '' ? `dsh-tui-${sessionId.slice(0, 13)}.md` : pathArgument
    const markdown = renderTranscriptMarkdown(model, sessionId)
    try {
      await writeFile(path, markdown, 'utf8')
      this.driver.model.pushNotice(`· exported ${markdown.length} bytes → ${path}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.driver.model.pushNotice(`· export failed: ${message.slice(0, 140)}`, 'error')
    }
  }

  /** Copy the n-th latest assistant text (default: latest) to the clipboard. */
  private copyAssistantText(argument: string): void {
    const model = this.driver.model
    const messages = model.items.filter(item => item.kind === 'assistant' && !item.live && item.text !== '') as Extract<TranscriptItem, { kind: 'assistant' }>[]
    if (messages.length === 0) {
      model.pushNotice('· nothing to copy yet')
      return
    }
    const index = argument === '' ? messages.length - 1 : messages.length - 1 - (Number.parseInt(argument, 10) || 0)
    const target = index >= 0 && index < messages.length ? messages[index] : undefined
    if (target === undefined) {
      model.pushNotice(`· /copy: only ${String(messages.length)} assistant message(s)`)
      return
    }
    osc52Copy(target.text)
    const preview = target.text.slice(0, 40).replace(/\n/g, ' ')
    model.pushNotice(`· copied ${String(target.text.length)} chars (${preview}…)`)
  }

  /** Language picker: every known locale; reserved ones answer honestly. */
  private async pickLanguage(argument: string): Promise<void> {
    if (argument !== '') {
      this.applyLanguage(argument)
      return
    }
    const current = locale()
    const dialog = new QuestionDialog({
      questions: [{
        id: 'language',
        question: t('dialog.languageTitle'),
        options: knownLocales().map(entry => ({
          label: `${entry.id === current ? '● ' : ''}${entry.label}`,
          ...(entry.available
            ? {}
            : { description: t('dialog.reservedHint') }),
        })),
      }],
    }, this.theme)
    const answer = await this.showDialog(dialog)
    const selected = answer.answers[0]?.selected[0]
    if (selected === undefined) {
      this.driver.model.pushNotice(t('notice.langCancelled'))
      return
    }
    const entry = knownLocales().find(candidate => `${candidate.id === current ? '● ' : ''}${candidate.label}` === selected)
    if (entry !== undefined) this.applyLanguage(entry.id)
  }

  private applyLanguage(name: string): void {
    const label = availableLocales().find(entry => entry.id === name)?.label ?? name
    if (setLocale(name)) {
      this.driver.model.pushNotice(t('notice.langChanged', { name: label }))
      return
    }
    // Reserved but untranslated (zh, ja): architecture ready, table pending.
    this.driver.model.pushNotice(t('notice.langUnavailable', { name: label, fallback: 'English' }))
  }

  /** Overlay picker over the llm catalog; applies the switch to the next step. */
  private async pickModel(): Promise<void> {
    const llm = this.ctx.get('llm')
    if (llm === undefined) {
      this.driver.model.pushNotice('· llm service unavailable', 'error')
      return
    }
    interface ModelEntry { provider: string, id: string, name: string, efforts: readonly { id: string, name: string }[] }
    const entries: ModelEntry[] = []
    try {
      for (const provider of llm.listProviders()) {
        const models = await llm.listModels(provider.id) as readonly {
          provider: string, id: string, name: string,
          reasoning?: { efforts?: readonly { id: string, name: string }[] }
        }[]
        for (const info of models) {
          entries.push({ provider: info.provider, id: info.id, name: info.name, efforts: info.reasoning?.efforts ?? [] })
        }
      }
    } catch (error: unknown) {
      this.driver.model.pushNotice(`· model catalog failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
      return
    }
    if (entries.length === 0) {
      this.driver.model.pushNotice('· no models advertised')
      return
    }

    const currentRoute = `${this.driver.route.provider}/${this.driver.route.model}`
    const labels = new Map<string, ModelEntry>()
    const options = entries.map(entry => {
      const label = `${entry.provider}/${entry.id}`
      labels.set(label, entry)
      return {
        label,
        ...(entry.name === '' || entry.name === entry.id ? {} : { description: entry.name }),
      }
    })
    const dialog = new QuestionDialog({
      questions: [{ id: 'model', question: t('dialog.modelTitle', { route: truncate(currentRoute, 44) }), options }],
    }, this.theme)
    const answer = await this.showDialog(dialog)
    const chosenLabel = answer.answers[0]?.selected[0]
    if (chosenLabel === undefined) {
      this.driver.model.pushNotice('· model picker cancelled')
      return
    }
    const chosen = labels.get(chosenLabel)
    if (chosen === undefined) return

    // Effort follow-up when the model offers more than one.
    let effort: string | undefined
    if (chosen.efforts.length > 1) {
      const effortDialog = new QuestionDialog({
        questions: [{
          id: 'effort',
          question: t('dialog.effortTitle', { model: chosen.id }),
          options: chosen.efforts.map(candidate => ({
            label: candidate.name === '' ? candidate.id : candidate.name,
            description: candidate.id,
          })),
        }],
      }, this.theme)
      const effortAnswer = await this.showDialog(effortDialog)
      const effortLabel = effortAnswer.answers[0]?.selected[0]
      if (effortLabel === undefined) {
        this.driver.model.pushNotice('· effort picker cancelled; keeping the default')
      } else {
        const found = chosen.efforts.find(candidate => (candidate.name === '' ? candidate.id : candidate.name) === effortLabel)
        effort = found?.id
      }
    }

    try {
      this.driver.setModel({ provider: chosen.provider, model: chosen.id, reasoningEffort: effort })
      this.driver.model.pushNotice(`· model → ${chosen.provider}/${chosen.id}${effort === undefined ? '' : ` (effort ${effort})`}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.driver.model.pushNotice(`· model switch failed: ${message.slice(0, 140)}`, 'error')
    }
  }

  /** /cwd with no argument shows the directory; with one it changes it. */
  private async dispatchCwd(path: string): Promise<void> {
    if (path === '') {
      this.driver.model.pushNotice(`· cwd ${this.driver.workingDirectory()}`)
      return
    }
    try {
      const resolved = await this.driver.setWorkingDirectory(path)
      this.driver.model.pushNotice(`· cwd → ${resolved}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.driver.model.pushNotice(`· cwd change failed: ${message.slice(0, 140)}`, 'error')
    }
  }

  /** Discard the active conversation view and return to the lazy state; the
   *  old session stays in /session, and the next message starts a new one. */
  private async startNewSession(): Promise<void> {
    const model = this.driver.model
    try {
      await this.driver.dispose()
    } catch (error: unknown) {
      this.log.debug(`driver dispose failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    model.reset()
    this.driver = await createDriver(this.ctx, model, { resume: undefined, model: undefined, lazy: true })
    this.refreshCommandAutocomplete()
    model.pushNotice(t('notice.newSessionStarted'))
  }

  /** Overlay picker over stored sessions; switching rebuilds the driver on the target. */
  private async pickSession(): Promise<void> {
    if (this.driver.running) {
      this.driver.model.pushNotice('· interrupt the running turn first (esc)')
      return
    }
    const query = this.ctx.get('sessionQuery') as SessionQueryLike | undefined
    if (query === undefined) {
      this.driver.model.pushNotice('· sessionQuery service unavailable', 'error')
      return
    }
    // Scope to this workspace and hide subagent child sessions (origin=subagent);
    // user-created fork branches stay visible.
    const records = (await query.listSessions()).filter(record =>
      record.header.cwd !== undefined
      && samePath(record.header.cwd, process.cwd())
      && record.header.origin !== 'subagent')
    if (records.length === 0) {
      this.driver.model.pushNotice(`· no stored sessions in ${truncate(process.cwd(), 60)}`)
      return
    }
    const titles = new Map<string, string>()
    try {
      const observations: readonly unknown[] = await query.readTitleSnapshots(records.map(record => record.header.id))
      for (const entry of observations) {
        const observation = entry as { sessionId?: unknown, status?: unknown, value?: { title?: { title?: string } } }
        if (observation.status !== 'fulfilled') continue
        const title = observation.value?.title?.title
        if (typeof observation.sessionId === 'string' && typeof title === 'string' && title !== '') {
          titles.set(observation.sessionId, title)
        }
      }
    } catch {
      // Titles are cosmetic; ids and times still identify the entries.
    }

    const currentId = this.driver.hasAgent ? String(this.driver.session?.id ?? '') : ''
    const workspace = process.cwd()
    const options: { value: string, label: string, description?: string }[] = []
    records.forEach((record) => {
      const id = String(record.header.id)
      const isCurrent = id === currentId
      const title = titles.get(id)
      const shortId = `${id.slice(0, 13)}…`
      const label = `${isCurrent ? '● ' : ''}${title === undefined ? shortId : truncate(title, 36)}`
      const parts = [
        record.live ? 'live' : 'stored',
        relativeTime(record.header.createdAt),
      ]
      options.push({
        value: id,
        label,
        ...(parts.length === 0 ? {} : { description: parts.join(' · ') }),
      })
    })

    const dialog = new QuestionDialog({
      questions: [{ id: 'session', question: t('dialog.sessionTitle', { workspace: truncate(workspace, 40) }), options: options.map(option => ({ label: option.label, ...(option.description === undefined ? {} : { description: option.description }) })) }],
    }, this.theme)
    const answer = await this.showDialog(dialog)
    const selected = answer.answers[0]?.selected[0]
    if (selected === undefined) {
      this.driver.model.pushNotice(t('notice.sessionCancelled'))
      return
    }
    // Map the chosen label back to its session id (labels are unique:
    // '● '-prefixed current marker + truncated title/short id + index-free).
    const chosen = options.find(option => option.label === selected)
    if (chosen === undefined || chosen.value === currentId) {
      this.driver.model.pushNotice(t('notice.sessionStays'))
      return
    }
    await this.switchSession(chosen.value)
  }

  /** Retire the current agent, reset the model, and resume the target session. */
  private async switchSession(sessionId: string): Promise<void> {
    const model = this.driver.model
    try {
      await this.driver.dispose()
    } catch (error: unknown) {
      this.log.debug(`driver dispose failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    model.reset()
    try {
      this.driver = await createDriver(this.ctx, model, { resume: sessionId, model: undefined })
      this.refreshCommandAutocomplete()
      this.driver.model.pushNotice(`· switched to session ${sessionId.slice(0, 13)}…`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.debug(`session resume failed: ${message}`)
      this.driver = await createDriver(this.ctx, model, { resume: undefined, model: undefined })
      this.refreshCommandAutocomplete()
      this.driver.model.pushNotice(`· resume failed; started a fresh session (${message.slice(0, 100)})`, 'error')
    }
  }

  /** Overlay picker over the permission-presets catalog; runs /permission <value>. */
  private async pickPermissionPreset(): Promise<boolean> {
    if (!this.driver.hasAgent) {
      this.driver.model.pushNotice(t('notice.needFirstMessage'))
      return true
    }
    const presets = this.ctx.get('permissionPresets')
    if (presets === undefined) {
      this.driver.model.pushNotice(t('notice.permissionServiceUnavailable'), 'error')
      return true
    }
    let current: string
    let options: { value: string, name: string, description?: string }[]
    try {
      current = presets.current(this.driver.agent!.session)
      const catalog = presets.catalog()
      options = catalog.options.filter(option => option.value !== 'custom')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.driver.model.pushNotice(`· permission catalog failed: ${message.slice(0, 140)}`, 'error')
      return true
    }
    const dialog = new QuestionDialog({
      questions: [{
        id: 'preset',
        question: t('dialog.permissionTitle', { preset: current }),
        options: options.map(option => ({
          label: option.name,
          ...(option.description === undefined ? {} : { description: option.description }),
        })),
      }],
    }, this.theme)
    const answer = await this.showDialog(dialog)
    const label = answer.answers[0]?.selected[0]
    if (label === undefined) {
      this.driver.model.pushNotice('· preset picker cancelled')
      return true
    }
    const chosen = options.find(option => option.name === label)
    if (chosen === undefined || chosen.value === current) {
      this.driver.model.pushNotice(`· permission stays ${current}`)
      return true
    }
    return this.dispatchCommand(`/permission ${chosen.value}`)
  }

  /** Slash-command dispatch: TUI-local commands plus the runtime registry. */
  private wireCommands(): void {
    this.refreshCommandAutocomplete()
    this.disposers.push(this.ctx.on('commands/change', () => {
      this.refreshCommandAutocomplete()
    }))
  }

  private refreshCommandAutocomplete(): void {
    const commands = this.ctx.get('commands')
    const localItems = [
      { name: 'exit', description: 'quit the TUI (alias: quit)' },
      { name: 'quit', description: 'quit the TUI (alias: exit)' },
      { name: 'clear', description: 'clear the transcript view' },
      { name: 'session', description: 'list stored sessions and switch (alias: resume)' },
      { name: 'new', description: 'start a fresh session (old one stays in /session)' },
      { name: 'resume', description: 'switch to a stored session (alias: session)' },
      { name: 'events', description: 'inspect raw session events' },
      { name: 'model', description: 'switch provider/model/effort' },
      { name: 'cwd', description: 'show or change the working directory' },
      { name: 'inbox', description: 'view and remove queued or steering input' },
      { name: 'fork', description: 'fork the current session and switch to it' },
      { name: 'expand', description: 'toggle all tool detail cards' },
      { name: 'todo', description: 'show the current todo list' },
      { name: 'theme', description: 'switch color theme (dark/light)' },
      { name: 'language', description: 'switch UI language' },
      { name: 'export', description: 'export the transcript as Markdown' },
      { name: 'copy', description: 'copy an assistant reply to the clipboard' },
    ]
    // Runtime (profile/plugin) commands are agent-scoped: they join the list
    // once the lazy session has materialized on the first message.
    if (commands !== undefined && this.driver.hasAgent) {
      try {
        const descriptors = commands.list(this.driver.agent!)
        for (const descriptor of descriptors) {
          localItems.unshift({ name: descriptor.name, description: descriptor.description })
        }
      } catch (error: unknown) {
        this.log.debug(`command list failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const fdPath = resolveFdPath()
    this.editor.setAutocompleteProvider(new ComposerAutocomplete(
      new CombinedAutocompleteProvider(localItems, process.cwd(), fdPath),
      process.cwd(),
      fdPath,
    ))
  }

  /** Dispatch one submitted line; returns true when consumed as a command. */
  private async dispatchCommand(line: string): Promise<boolean> {
    if (!line.startsWith('/')) return false
    if (line === '/exit' || line === '/quit') {
      // Exactly Ctrl+Q's path: no notice first — a model change here would
      // invalidate the transcript render cache right before the exit
      // print-back forces a full re-render (slow exit, long exposed window).
      this.finishApp?.(0)
      return true
    }
    if (line === '/clear') {
      this.transcript.invalidate()
      this.driver.model.pushNotice(t('notice.viewCleared'))
      return true
    }
    if (line === '/session' || line === '/sessions' || line === '/resume') {
      await this.pickSession()
      return true
    }
    if (line === '/events') {
      const dialog = new EventsDialog(this.driver.model.recent, this.theme)
      await this.showDialog(dialog)
      return true
    }
    if (line === '/expand') {
      this.driver.model.toggleAllToolDetails()
      return true
    }
    if (line === '/todo' || line === '/todos') {
      await this.showTodoList()
      return true
    }
    if (line === '/theme' || line.startsWith('/theme ')) {
      await this.pickTheme(line.slice(6).trim())
      return true
    }
    if (line === '/language' || line === '/lang') {
      await this.pickLanguage('')
      return true
    }
    if (line.startsWith('/language ')) {
      await this.pickLanguage(line.slice(10).trim())
      return true
    }
    if (line.startsWith('/lang ')) {
      await this.pickLanguage(line.slice(5).trim())
      return true
    }
    if (line === '/export' || line.startsWith('/export ')) {
      await this.exportTranscript(line.slice(7).trim())
      return true
    }
    if (line === '/copy' || line.startsWith('/copy ')) {
      this.copyAssistantText(line.slice(5).trim())
      return true
    }
    if (line === '/model' || line === '/models') {
      await this.pickModel()
      return true
    }
    if (line === '/inbox') {
      await this.pickInboxMessage()
      return true
    }
    if (line === '/fork') {
      await this.forkSession()
      return true
    }
    if (line === '/new') {
      if (this.driver.running) {
        this.driver.model.pushNotice(t('notice.interruptFirst'))
        return true
      }
      if (!this.driver.hasAgent) {
        this.driver.model.pushNotice(t('notice.alreadyFresh'))
        return true
      }
      await this.startNewSession()
      return true
    }
    if (line === '/cwd' || line.startsWith('/cwd ')) {
      await this.dispatchCwd(line.slice(4).trim())
      return true
    }
    if (line === '/permission' || line === '/permissions') {
      if (!this.driver.hasAgent) {
        this.driver.model.pushNotice(t('notice.needFirstMessage'))
        return true
      }
      return this.pickPermissionPreset()
    }
    // Runtime (profile/plugin) registry commands need the agent.
    if (!this.driver.hasAgent) {
      this.driver.model.pushNotice(t('notice.needFirstMessage'))
      return true
    }
    const commands = this.ctx.get('commands')
    if (commands === undefined) {
      this.driver.model.pushNotice(t('notice.noCommandRegistry'), 'error')
      return true
    }
    try {
      const execution = await commands.execute(this.driver.agent!, line, [], new AbortController().signal)
      if (execution === undefined) {
        this.driver.model.pushNotice(t('notice.unknownCommand', { command: line.split(' ')[0] ?? line }), 'error')
        return true
      }
      const result = execution.result
      if (result.kind === 'error') {
        this.driver.model.pushNotice(t('notice.commandFailed', { message: result.text.slice(0, 180) }), 'error')
      } else if (result.text !== undefined && result.text !== '') {
        this.driver.model.pushNotice(`· ${result.text.slice(0, 400)}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.driver.model.pushNotice(t('notice.commandFailed', { message: message.slice(0, 180) }), 'error')
    }
    return true
  }

  /** Serializes dialogs so concurrent requests queue instead of stacking. */
  private dialogQueue: Promise<unknown> = Promise.resolve()

  private wireInteractions(ctx: Context): void {
    this.disposers.push(ctx.on('approval/request', (request, next) => this.guardWaterfall('approval', async () => {
      const dialog = new ApprovalDialog(request, this.theme)
      const outcome = await this.showDialog(dialog)
      this.driver.model.pushNotice(
        outcome === 'allowed-once'
          ? `· approved ${request.toolName}`
          : outcome === 'rejected'
            ? `· rejected ${request.toolName}`
            : `· approval cancelled (${request.toolName})`,
      )
      return outcome
    }, next)))

    this.disposers.push(ctx.on('user-questions/request', (request, next) => this.guardWaterfall('questions', async () => {
      const dialog = new QuestionDialog({ questions: request.questions, signal: request.signal }, this.theme)
      const answer = await this.showDialog(dialog)
      this.driver.model.pushNotice(
        answer.answers.length === 0
          ? '· questions cancelled'
          : `· answered ${String(answer.answers.length)} question(s)`,
      )
      return answer
    }, next)))
  }

  /** Degrade waterfall-handler failures to next() instead of a broken chain. */
  private async guardWaterfall<T>(label: string, answer: () => Promise<T>, next: () => Promise<T>): Promise<T> {
    try {
      return await answer()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.debug(`${label} dialog failed: ${message}`)
      this.driver.model.pushNotice(`· ui error (${label}): ${message.slice(0, 120)}`, 'error')
      return next()
    }
  }

  private showDialog<T>(dialog: Component & { readonly done: Promise<T> }): Promise<T> {
    const run = async (): Promise<T> => {
      const handle = this.tui.showOverlay(dialog, { width: '100%', anchor: 'bottom-left', margin: 0 })
      this.tui.requestRender()
      try {
        return await dialog.done
      } finally {
        handle.hide()
        // Full repaint: console-direct writes from stray children may have
        // damaged rows the differential renderer would leave untouched.
        this.tui.renderNow(true)
      }
    }
    const queued = this.dialogQueue.then(run, run)
    this.dialogQueue = queued.catch(() => {})
    return queued
  }

  private wire(model: TranscriptModel): void {
    const render = (): void => {
      this.header.set(headerLine(model, this.theme), this.driver.running)
      this.hints.setText(hintsLine(this.driver, this.theme))
    }
    // Exceptions inside event listeners and render callbacks would take down
    // the whole process (uncaught in a timer/stdin context); degrade to a
    // visible notice and a log line instead.
    const guard = (action: () => void, label: string): void => {
      try {
        action()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        this.log.debug(`${label} failed: ${message}`)
        try {
          model.pushNotice(`· ui error (${label}): ${message.slice(0, 120)}`, 'error')
        } catch {
          // Pushing the notice itself failed; the log line above is all we can do.
        }
      }
    }
    this.disposers.push(model.onChange(() => {
      guard(() => {
        // The transcript's cached lines are stale the moment the model moved;
        // without this invalidate the viewport never shows new items.
        this.transcript.invalidate()
        render()
        this.tui.requestRender()
      }, 'render')
    }))
    // Running/idle flips are NOT model events: without this hook the header
    // spinner keeps animating (and emitting output) after the turn ended.
    this.disposers.push(this.driver.onStatus((running) => {
      guard(() => {
        // ConEmu-style progress state so terminals (and vterm's addons) can
        // report busy/idle: state 1 = indeterminate, 0 = clear.
        process.stdout.write(running ? '\x1b]9;4;1;0\x07' : '\x1b]9;4;0;0\x07')
        render()
        this.tui.requestRender()
      }, 'status-render')
    }))
    render()
  }

  /** Run until the user quits; resolves with the exit code. */
  async run(initialPrompt: string | undefined, openSessionPicker = false): Promise<AppResult> {
    let settled = false
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      this.finishApp = undefined
      void this.shutdown(code)
    }
    this.finishApp = finish

    // Global keys run before the focused editor.
    let lastInterrupt = 0
    this.tui.addInputListener((data) => {
      try {
        if (matchesKey(data, Key.ctrl('q'))) {
          finish(0)
          return { consume: true }
        }
        if (matchesKey(data, Key.ctrl('c'))) {
          if (this.driver.running) {
            this.driver.cancel()
            return { consume: true }
          }
          const now = Date.now()
          if (now - lastInterrupt < 1500) {
            finish(0)
          } else {
            lastInterrupt = now
            this.driver.model.pushNotice('· press ctrl+c again to quit')
          }
          return { consume: true }
        }
        if (matchesKey(data, Key.escape) && this.driver.running) {
          this.driver.cancel()
          return { consume: true }
        }
        // Stray child processes (browsers, GUI apps) can write to the Windows
        // console directly, bypassing every in-process capture; a forced full
        // repaint erases the damage. Classic Ctrl+L redraw.
        if (matchesKey(data, Key.ctrl('l'))) {
          this.tui.renderNow(true)
          return { consume: true }
        }
        // Ctrl+O toggles the newest tool item's detail card (diff, read
        // slice, terminal output, search list).
        if (matchesKey(data, Key.ctrl('o'))) {
          this.driver.model.toggleLastToolDetails()
          return { consume: true }
        }
        // Alt+Enter submits the composer as a steering message for the next
        // step of the running turn (Enter stays send/queue; Shift+Enter and
        // Ctrl+Enter remain newline). Consumed before the editor sees it.
        if (matchesKey(data, Key.alt('enter'))) {
          const text = this.editor.getText().trim()
          if (text !== '') {
            this.submitText(text, true)
            return { consume: true }
          }
        }
        return undefined
      } catch (error: unknown) {
        // An input-handler exception would crash the process from inside the
        // stdin data handler; surface it in-UI instead.
        const message = error instanceof Error ? error.message : String(error)
        this.log.debug(`input handler failed: ${message}`)
        this.driver.model.pushNotice(`· ui error (input): ${message.slice(0, 120)}`, 'error')
        return { consume: true }
      }
    })

    this.editor.onSubmit = (text: string): void => {
      const trimmed = text.trim()
      if (trimmed === '') return
      this.submitText(trimmed, false)
    }

    this.tui.start()
    if (openSessionPicker) {
      // Bare -r: pick a stored session before anything else happens.
      await this.pickSession()
    }
    if (initialPrompt !== undefined && initialPrompt.trim() !== '') {
      this.driver.send(initialPrompt)
    }
    return new Promise<AppResult>((resolve) => {
      this.onShutdown = (code) => { resolve({ exitCode: code }) }
    })
  }

  /** One submission path for Enter (send/queue) and Alt+Enter (steer). */
  private submitText(trimmed: string, steer: boolean): void {
    this.editor.addToHistory(trimmed)
    if (trimmed.startsWith('/')) {
      void this.dispatchCommand(trimmed).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.driver.model.pushNotice(`· command failed: ${message.slice(0, 120)}`, 'error')
      })
      return
    }
    if (steer) {
      this.driver.steer(trimmed)
        .then(() => { this.driver.model.pushNotice(t('notice.steering', { text: firstLineOf(trimmed) })) })
        .catch((error: unknown) => this.reportSubmitFailure(error))
      return
    }
    if (this.driver.running) this.driver.model.pushNotice(t('notice.queued', { text: firstLineOf(trimmed) }))
    this.driver.send(trimmed)
      .then(() => this.refreshCommandAutocomplete())
      .catch((error: unknown) => this.reportSubmitFailure(error))
  }

  private reportSubmitFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.log.debug(`submit failed: ${message}`)
    this.driver.model.pushNotice(t('notice.sendFailed', { message: message.slice(0, 120) }), 'error')
  }

  private onShutdown: ((code: number) => void) | undefined
  /** Quit request callable shared with command dispatch (/exit, /quit). */
  private finishApp: ((code: number) => void) | undefined

  private async shutdown(code: number): Promise<void> {
    this.log.debug(`shutdown: begin (code ${String(code)})`)
    const step = (label: string, action: () => void | Promise<void>): Promise<void> => {
      return Promise.resolve()
        .then(action)
        .catch((error: unknown) => {
          // A failure in any teardown step must degrade to a log line, never
          // an unhandled rejection that kills the process after the screen
          // was already restored.
          this.log.debug(`shutdown ${label} failed: ${error instanceof Error ? error.message : String(error)}`)
        })
    }

    // Signal shield: the moment tui.stop() restores cooked mode, any further
    // Ctrl+C becomes a real console interrupt — it hits the parent shell and
    // drives the launcher's interrupt() into an immediate exit(130)
    // mid-teardown (killing the terminal window). The process is already
    // leaving through appExit; swallow stray signals for the remainder.
    await step('shield-signals', () => {
      process.removeAllListeners('SIGINT')
      process.removeAllListeners('SIGTERM')
      process.on('SIGINT', () => { this.log.debug('sigint shielded during teardown') })
      process.on('SIGTERM', () => { this.log.debug('sigterm shielded during teardown') })
    })

    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
    await step('stop-spinner', () => { this.header.dispose() })
    await step('stop-driver', () => { this.driver.stop() })

    // pi-tui 1.3.0's stop() document print-back is defective with layout
    // roots (renders only the scroll region's first row and can throw on
    // populated transcripts — docs/render-decision.md). Preserve the screen
    // instead and print the transcript ourselves from the view model.
    await step('stop-renderer', () => { this.tui.stop({ preserveScreen: true }) })
    await step('print-transcript', () => { printTranscriptForScrollback(this.transcript) })

    await step('restore-stderr', () => {
      const pending = this.stderr.restore()
      if (pending !== '') process.stderr.write(pending)
    })
    await step('flush', async () => {
      await Promise.race([
        this.driver.flush(),
        new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 4000)
          timer.unref()
        }),
      ])
    })
    await step('clear-progress', () => {
      // Clear the ConEmu progress state on exit so the tab never stays "busy".
      process.stdout.write('\x1b]9;4;0;0\x07')
    })
    this.log.debug('shutdown: complete')
    this.onShutdown?.(code)
  }
}

function firstLineOf(text: string): string {
  const line = text.split('\n').find(candidate => candidate.trim() !== '') ?? ''
  return line.length > 48 ? `${line.slice(0, 47)}…` : line
}

function headerLine(model: TranscriptModel, theme: Theme): string {
  const project = basename(process.cwd())
  const title = model.title === undefined ? t('header.newSession') : truncate(model.title, 24)
  const preset = model.preset === undefined ? '' : ` · ${model.preset}`
  const modelRoute = truncate(model.model ?? '', 28)
  const modelSegment = modelRoute === '' ? '' : ` · ${modelRoute}`
  const tokens = `${model.inputTokens + model.outputTokens}${t('header.tokens')}`
  return theme.dim(` ${project} · ${title}${preset}${modelSegment} · ${tokens}`)
}

function hintsLine(driver: AgentDriver, theme: Theme): string {
  return theme.dim(driver.running
    ? 'enter queue · alt+enter steer · esc interrupt · ctrl+q quit'
    : 'enter send · alt+enter steer · / commands · ctrl+q quit')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The sessionQuery surface the picker uses (structural; see dsh-session-query). */
interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<readonly {
    header: {
      id: string
      createdAt: number
      cwd?: string | undefined
      /** Set for subagent child sessions; excluded from the picker. */
      origin?: string | undefined
    }
    live: boolean
  }[]>
  readTitleSnapshots(ids: readonly string[], signal?: AbortSignal): Promise<readonly unknown[]>
}

/** Copy helper: the n-th latest assistant text via OSC 52 clipboard write. */
function osc52Copy(text: string): void {
  const payload = Buffer.from(text, 'utf8').toString('base64')
  // Terminals without OSC 52 support ignore the sequence silently.
  process.stdout.write(`\x1b]52;c;${payload}\x07`)
}

/** Markdown export of one transcript. */
function renderTranscriptMarkdown(model: TranscriptModel, sessionId: string): string {
  const lines: string[] = [
    `# ${model.title === undefined ? 'dsh-tui transcript' : model.title}`,
    '',
    `> session \`${sessionId}\` · model ${model.model ?? '(default)'} · ${model.inputTokens + model.outputTokens} tokens · exported ${new Date().toISOString()}`,
    '',
  ]
  for (const item of model.items) {
    switch (item.kind) {
      case 'user':
        lines.push('## ❯ user', '', item.text, '')
        break
      case 'assistant': {
        lines.push('## assistant', '')
        if (item.reasoning !== '') lines.push('<details><summary>reasoning</summary>', '', item.reasoning, '', '</details>', '')
        if (item.text !== '') lines.push(item.text, '')
        if (item.usage !== undefined) {
          lines.push(`> ${String(item.usage.inputTokens)} in / ${String(item.usage.outputTokens)} out tokens`, '')
        }
        break
      }
      case 'tool': {
        const headline = item.resultView !== undefined || item.callView !== undefined
          ? item.name
          : `${item.name} ${item.argDigest}`
        lines.push(`**tool** \`${headline}\`${item.status === 'error' ? ' *(error)*' : ''}`)
        if (item.resultDigest !== undefined) lines.push('', '```text', item.resultDigest, '```')
        lines.push('')
        break
      }
      case 'notice':
        lines.push(`> ${item.text.replace(/^·\s*/, '')}`, '')
        break
    }
  }
  return `${lines.join('\n')}\n`
}

/** Startup banner: version, current route, developer contact, first hints. */
function pushWelcome(model: TranscriptModel, driver: AgentDriver): void {
  const version: string = packageInfo.version
  model.pushNotice(t('welcome.title', { version }))
  model.pushNotice(t('welcome.line', { route: `${driver.route.provider}/${driver.route.model}` }))
  model.pushNotice(t('welcome.contact'))
}

/** Compact relative time for the session picker. */
function relativeTime(createdAtMs: number): string {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - createdAtMs) / 1000))
  if (deltaSeconds < 60) return `${String(deltaSeconds)}s ago`
  if (deltaSeconds < 3600) return `${String(Math.floor(deltaSeconds / 60))}m ago`
  if (deltaSeconds < 86400) return `${String(Math.floor(deltaSeconds / 3600))}h ago`
  return `${String(Math.floor(deltaSeconds / 86400))}d ago`
}

/** Case-insensitive, separator-normalized path equality for cwd scoping. */
function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const unified = value.replaceAll('/', '\\')
    return process.platform === 'win32' ? unified.toLowerCase() : value
  }
  return normalize(left) === normalize(right)
}

/**
 * Print the final transcript into the terminal's normal scrollback after the
 * alt screen exited (opencode-style exit). Renders from our own view model —
 * never through the renderer's stop() print-back (defective with layout
 * roots in pi-tui 1.3.0; see docs/render-decision.md).
 */
function printTranscriptForScrollback(transcript: TranscriptView): void {
  // Match the layout render width exactly (the terminal width) so the exit
  // print hits the view's render cache instead of forcing a full re-render.
  const width = Math.max(40, Math.min(1000, process.stdout.columns ?? 80))
  const lines = transcript.render(width)
  if (lines.length === 0) return
  process.stdout.write(`\n${lines.join('\n')}\n`)
}
