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
import { ApprovalDialog, QuestionDialog } from './dialogs.ts'
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
    readonly driver: AgentDriver,
    private readonly tui: TuiAltScreen,
    private readonly stderr: StderrCapture,
    private readonly transcript: TranscriptView,
    private readonly header: LineText,
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

    const header = new LineText('', 1)
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
    app.wire(model, driver)
    app.wireInteractions(ctx)
    app.wireCommands(model)
    return app
  }

  /** Overlay picker over the permission-presets catalog; runs /permission <value>. */
  private async pickPermissionPreset(): Promise<boolean> {
    const presets = this.ctx.get('permissionPresets')
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
  private wireCommands(model: TranscriptModel): void {
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

  private wire(model: TranscriptModel, driver: AgentDriver): void {
    const render = (): void => {
      this.header.setText(headerLine(model, driver))
      this.hints.setText(hintsLine(driver))
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
      if (trimmed.startsWith('/')) {
        void this.dispatchCommand(trimmed).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          this.driver.model.pushNotice(`· command failed: ${message.slice(0, 120)}`, 'error')
        })
        return
      }
      try {
        if (this.driver.running) this.driver.model.pushNotice(`(queued: ${firstLineOf(trimmed)})`)
        this.driver.send(trimmed)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        this.log.debug(`submit failed: ${message}`)
        this.driver.model.pushNotice(`· send failed: ${message.slice(0, 120)}`, 'error')
      }
    }

    this.tui.start()
    if (initialPrompt !== undefined && initialPrompt.trim() !== '') {
      this.driver.send(initialPrompt)
    }
    return new Promise<AppResult>((resolve) => {
      this.onShutdown = (code) => { resolve({ exitCode: code }) }
    })
  }

  private onShutdown: ((code: number) => void) | undefined

  private async shutdown(code: number): Promise<void> {
    for (const dispose of this.disposers) dispose()
    this.driver.stop()
    this.tui.stop()
    const pending = this.stderr.restore()
    if (pending !== '') process.stderr.write(pending)
    try {
      await this.driver.flush()
    } catch (error: unknown) {
      this.log.debug(`flush failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.onShutdown?.(code)
  }
}

function firstLineOf(text: string): string {
  const line = text.split('\n').find(candidate => candidate.trim() !== '') ?? ''
  return line.length > 48 ? `${line.slice(0, 47)}…` : line
}

function headerLine(model: TranscriptModel, driver: AgentDriver): string {
  const theme = themeByName(undefined)
  const project = basename(process.cwd())
  const title = model.title === undefined ? 'new session' : truncate(model.title, 24)
  const preset = model.preset === undefined ? '' : ` · ${model.preset}`
  const tokens = `${model.inputTokens + model.outputTokens} tok`
  const status = driver.running ? 'running' : 'idle'
  return theme.dim(`${project} · ${title}${preset} · ${status} · ${tokens}`)
}

function hintsLine(driver: AgentDriver): string {
  const theme = themeByName(undefined)
  return theme.dim(driver.running
    ? 'enter queue · esc interrupt · ctrl+l redraw · ctrl+q quit'
    : 'enter send · / commands · ctrl+l redraw · ctrl+q quit')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
