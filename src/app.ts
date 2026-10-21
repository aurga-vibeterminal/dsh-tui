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
  type Component,
} from '@earendil-works/pi-tui'
import type {} from '@deepseek-ai/dsh-commands'
import { createDriver, type AgentDriver, type DriverModelRoute } from './agent-driver.ts'
import { TranscriptModel } from './events.ts'
import { TranscriptView, type ItemContext } from './components/transcript.ts'
import { LineText } from './components/line-text.ts'
import { ApprovalDialog, EventsDialog, QuestionDialog } from './dialogs.ts'
import { StatusLine } from './components/status-line.ts'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { markdownThemeFor, selectListThemeFor, themeByName, type Theme } from './theme.ts'
import { createDebugLogger, StderrCapture, type Logger } from './util/log.ts'

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
    private readonly theme: Theme,
    private readonly log: Logger,
    private readonly disposers: Array<() => void>,
  ) {}

  /**
   * Build the app: driver first (its subscription feeds the model), then the
   * layout, then input handling.
   */
  static async create(ctx: Context, options: AppOptions): Promise<TuiApp> {
    const theme = themeByName(options.theme)
    const log = createDebugLogger()
    const model = new TranscriptModel()
    const driver = await createDriver(ctx, model, { resume: options.resume, model: options.model })

    const stderr = new StderrCapture(log)
    stderr.install()

    const tui = new TuiAltScreen(new ProcessTerminal())
    const itemContext: ItemContext = { theme, markdownTheme: markdownThemeFor(theme) }

    const header = new StatusLine(() => {
      tui.requestRender()
    })
    const transcript = new TranscriptView(model.items, itemContext)
    const hints = new LineText('', 1)
    const editor = new Editor(tui, {
      borderColor: theme.border,
      selectList: selectListThemeFor(theme),
    })
    const composer = new VStack([editor, hints])

    const scroll = new ScrollView(transcript, { follow: 'end', primary: true, overscroll: 'chain' })
    if (isViewportTUI(tui)) {
      tui.setLayoutRoot(new VStack([
        { component: scroll, basis: 0, grow: 1, minSize: 1 },
        { component: header, basis: 'auto', minSize: 1 },
        { component: composer, basis: 'auto', shrink: 1, minSize: 1 },
      ]))
    }
    tui.setFocus(editor)

    const app = new TuiApp(ctx, driver, tui, stderr, transcript, header, hints, editor, theme, log, [])
    app.wire(model)
    app.wireInteractions(ctx)
    app.wireCommands()
    return app
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
      questions: [{ id: 'model', question: `Model (current: ${truncate(currentRoute, 44)})`, options }],
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
          question: `Reasoning effort for ${chosen.id}`,
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
    const records = (await query.listSessions()).filter(record =>
      record.header.cwd !== undefined && samePath(record.header.cwd, process.cwd()))
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

    const currentId = String(this.driver.session.id)
    const workspace = process.cwd()
    const labels = new Map<string, { id: string }>()
    const options: { label: string, description?: string }[] = []
    records.slice(0, 20).forEach((record, index) => {
      const id = String(record.header.id)
      const isCurrent = id === currentId
      const title = titles.get(id)
      const shortId = `${id.slice(0, 13)}…`
      const label = `${String(index + 1)}. ${isCurrent ? '● ' : ''}${title === undefined ? shortId : truncate(title, 36)}`
      labels.set(label, { id })
      const parts = [
        record.live ? 'live' : 'stored',
        relativeTime(record.header.createdAt),
      ]
      options.push({
        label,
        ...(parts.length === 0 ? {} : { description: parts.join(' · ') }),
      })
    })

    const dialog = new QuestionDialog({
      questions: [{ id: 'session', question: `Switch to session (${truncate(workspace, 40)})`, options }],
    }, this.theme)
    const answer = await this.showDialog(dialog)
    const selected = answer.answers[0]?.selected[0]
    if (selected === undefined) {
      this.driver.model.pushNotice('· session picker cancelled')
      return
    }
    const chosen = labels.get(selected)
    if (chosen === undefined || chosen.id === currentId) {
      this.driver.model.pushNotice('· staying on the current session')
      return
    }
    await this.switchSession(chosen.id)
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
  private async pickPermissionPreset(): Promise<boolean> {    const presets = this.ctx.get('permissionPresets')
    if (presets === undefined) {
      this.driver.model.pushNotice('· permission-presets service unavailable', 'error')
      return true
    }
    let current: string
    let options: { value: string, name: string, description?: string }[]
    try {
      current = presets.current(this.driver.agent.session)
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
        question: `Permission preset (current: ${current})`,
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
    if (commands === undefined) return
    try {
      const descriptors = commands.list(this.driver.agent)
      const items = [
        ...descriptors.map(descriptor => ({ name: descriptor.name, description: descriptor.description })),
        { name: 'exit', description: 'quit the TUI' },
        { name: 'clear', description: 'clear the transcript view' },
        { name: 'session', description: 'list stored sessions and switch to one' },
        { name: 'events', description: 'inspect raw session events' },
        { name: 'model', description: 'switch provider/model/effort' },
        { name: 'cwd', description: 'show or change the working directory' },
      ]
      this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(items, process.cwd()))
    } catch (error: unknown) {
      this.log.debug(`command autocomplete failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Dispatch one submitted line; returns true when consumed as a command. */
  private async dispatchCommand(line: string): Promise<boolean> {
    if (!line.startsWith('/')) return false
    const commands = this.ctx.get('commands')
    if (line === '/exit' || line === '/quit') {
      // Routed through the normal quit path for clean teardown.
      this.driver.model.pushNotice('· use ctrl+q to quit')
      return true
    }
    if (line === '/clear') {
      this.transcript.invalidate()
      this.driver.model.pushNotice('· view cleared (session history intact)')
      return true
    }
    if (line === '/session' || line === '/sessions') {
      await this.pickSession()
      return true
    }
    if (line === '/events') {
      const dialog = new EventsDialog(this.driver.model.recent, this.theme)
      await this.showDialog(dialog)
      return true
    }
    if (line === '/model' || line === '/models') {
      await this.pickModel()
      return true
    }
    if (line === '/cwd' || line.startsWith('/cwd ')) {
      await this.dispatchCwd(line.slice(4).trim())
      return true
    }
    if (commands === undefined) {
      this.driver.model.pushNotice('· no command registry composed', 'error')
      return true
    }
    // Bare /permission opens a preset picker instead of printing text.
    if (line === '/permission' || line === '/permissions') {
      return this.pickPermissionPreset()
    }
    try {
      const execution = await commands.execute(this.driver.agent, line, [], new AbortController().signal)
      if (execution === undefined) {
        this.driver.model.pushNotice(`· unknown command ${line.split(' ')[0]}`, 'error')
        return true
      }
      const result = execution.result
      if (result.kind === 'error') {
        this.driver.model.pushNotice(`· ${result.text.slice(0, 180)}`, 'error')
      } else if (result.text !== undefined && result.text !== '') {
        this.driver.model.pushNotice(`· ${result.text.slice(0, 400)}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.driver.model.pushNotice(`· command failed: ${message.slice(0, 180)}`, 'error')
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
      this.header.set(headerLine(model), this.driver.running)
      this.hints.setText(hintsLine(this.driver))
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
    render()
  }

  /** Run until the user quits; resolves with the exit code. */
  async run(initialPrompt: string | undefined): Promise<AppResult> {
    let settled = false
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      void this.shutdown(code)
    }

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
    try {
      if (steer) {
        this.driver.steer(trimmed)
        this.driver.model.pushNotice(`(steering: ${firstLineOf(trimmed)})`)
      } else {
        if (this.driver.running) this.driver.model.pushNotice(`(queued: ${firstLineOf(trimmed)})`)
        this.driver.send(trimmed)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.debug(`submit failed: ${message}`)
      this.driver.model.pushNotice(`· send failed: ${message.slice(0, 120)}`, 'error')
    }
  }

  private onShutdown: ((code: number) => void) | undefined

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
    this.log.debug('shutdown: complete')
    this.onShutdown?.(code)
  }
}

function firstLineOf(text: string): string {
  const line = text.split('\n').find(candidate => candidate.trim() !== '') ?? ''
  return line.length > 48 ? `${line.slice(0, 47)}…` : line
}

function headerLine(model: TranscriptModel): string {
  const theme = themeByName(undefined)
  const project = basename(process.cwd())
  const title = model.title === undefined ? 'new session' : truncate(model.title, 24)
  const preset = model.preset === undefined ? '' : ` · ${model.preset}`
  const modelRoute = truncate(model.model ?? '', 28)
  const modelSegment = modelRoute === '' ? '' : ` · ${modelRoute}`
  const tokens = `${model.inputTokens + model.outputTokens} tok`
  return theme.dim(` ${project} · ${title}${preset}${modelSegment} · ${tokens}`)
}

function hintsLine(driver: AgentDriver): string {
  const theme = themeByName(undefined)
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
    header: { id: string, createdAt: number, cwd?: string | undefined }
    live: boolean
  }[]>
  readTitleSnapshots(ids: readonly string[], signal?: AbortSignal): Promise<readonly unknown[]>
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
  const width = Math.max(40, Math.min(160, process.stdout.columns ?? 80))
  const lines = transcript.render(width)
  if (lines.length === 0) return
  process.stdout.write(`\n${lines.join('\n')}\n`)
}
