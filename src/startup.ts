/**
 * dsh-tui startup provider: parses this app's flag family from the launcher's
 * immutable argument snapshot and publishes the {@link TUI_STARTUP_SERVICE}
 * the runner row injects. Modeled on `@deepseek-ai/dsh-headless/startup`.
 * @module dsh-tui/startup
 */

import { Command, Option } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the flags can be parsed. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the TUI runner row. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** One `--model` value split into its route parts. */
export interface TuiModelRoute {
  /** LLM provider id, for example `deepseek-official`. */
  provider: string
  /** Model id within the provider, for example `deepseek-flash`. */
  model: string
}

/** What the runner row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Exact persisted Session identity to resume; absent for a fresh session. */
  resume: string | undefined
  /** Bare `-r`: open the session picker at startup. */
  resumePicker: boolean
  /** Explicit model route; absent keeps the profile's default selection. */
  model: TuiModelRoute | undefined
  /** Adapter-owned reasoning-effort id; absent keeps the model default. */
  reasoningEffort: string | undefined
  /** UI theme name; absent keeps the runner default. */
  theme: string | undefined
  /** Initial prompt text; multiple words join with spaces. */
  prompt: string | undefined
  /** Dev tooling: record one turn's raw events into this directory, then exit. */
  record: string | undefined
  /** Dev tooling (with --record): interrupt the turn after this many ms. */
  interruptAfterMs: number | undefined
  /** Agent preset mode id (standard | ptc | minimal | cordis). */
  preset: string | undefined
}

/** Commander option shape of this app's program. */
interface TuiOptions {
  resume?: string | boolean | undefined
  preset?: string | undefined
  model?: string | undefined
  reasoningEffort?: string | undefined
  theme?: string | undefined
  record?: string | undefined
  /** Commander exposes `--interrupt-after <ms>` under this key (no -Ms suffix). */
  interruptAfter?: string | undefined
}

const PRESET_IDS = ['standard', 'ptc', 'minimal', 'cordis'] as const

/**
 * This app's command: its flags and help text. Fresh per call, so one process
 * can parse more than once (tests).
 * @returns the commander program without an action.
 */
export function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Interactive terminal UI for a DeepSeek Harness agent.')
    .helpOption('-h, --help', 'show this help')
    .option('-r, --resume [id]', 'resume a session: with an id resume that one; bare -r opens the session picker at startup')
    .option('--preset <id>', 'agent preset mode: standard | ptc | minimal | cordis (default: standard)')
    .option('--model <provider/model>', 'explicit model route; overrides the profile default')
    .option('--reasoning-effort <id>', 'adapter-owned reasoning effort for the selected route')
    .option('--theme <name>', 'UI theme name (default: dark)')
    .addOption(new Option('--record <dir>', 'dev: record one turn of raw events to <dir> as test fixtures, then exit').hideHelp())
    .addOption(new Option('--interrupt-after <ms>', 'dev: with --record, interrupt the turn after this many milliseconds').hideHelp())
    .argument('[prompt...]', 'initial prompt text; required with --record')
    .addHelpText('after', `
Examples:
  dsh --profile tui                                    start a fresh session
  dsh --profile tui --resume session-…                 continue a stored session
  dsh --profile tui --model deepseek-official/deepseek-flash
`)
}

/**
 * Validate and normalize parsed options into startup values.
 * @param options - commander's parsed option set.
 * @param error - rejects the invocation (commander control-flow error).
 * @returns the values the runner consumes.
 */
function valuesFromOptions(options: TuiOptions, args: readonly string[], error: (message: string) => never): TuiStartupValues {
  const resumeRaw = options.resume
  let resume: string | undefined
  const resumePicker = resumeRaw === true
  if (typeof resumeRaw === 'string') {
    resume = resumeRaw
    if (resume.trim() === '') {
      error('--resume requires a non-empty session id')
    }
  }
  const modelRaw = options.model
  let model: TuiModelRoute | undefined
  if (modelRaw !== undefined) {
    const separator = modelRaw.indexOf('/')
    const provider = separator <= 0 ? '' : modelRaw.slice(0, separator).trim()
    const modelId = separator < 0 ? '' : modelRaw.slice(separator + 1).trim()
    if (provider === '' || modelId === '') {
      error(`--model expects <provider>/<model>, received ${JSON.stringify(modelRaw)}`)
    }
    model = { provider, model: modelId }
  }
  const preset = options.preset
  if (preset !== undefined && !(PRESET_IDS as readonly string[]).includes(preset)) {
    error(`--preset expects one of ${PRESET_IDS.join(' | ')}, received ${JSON.stringify(preset)}`)
  }
  const reasoningEffort = options.reasoningEffort
  if (reasoningEffort !== undefined && reasoningEffort.trim() === '') {
    error('--reasoning-effort requires a non-empty id')
  }
  const theme = options.theme
  if (theme !== undefined && theme.trim() === '') {
    error('--theme requires a non-empty name')
  }
  const record = options.record
  if (record !== undefined && record.trim() === '') {
    error('--record requires a non-empty output directory')
  }
  const rawInterruptAfter = options.interruptAfter
  let interruptAfterMs: number | undefined
  if (rawInterruptAfter !== undefined) {
    const parsed = Number(rawInterruptAfter)
    if (rawInterruptAfter.trim() === '' || !Number.isInteger(parsed) || parsed < 0) {
      error('--interrupt-after expects a non-negative integer milliseconds value')
    }
    interruptAfterMs = parsed
  }
  if (interruptAfterMs !== undefined && record === undefined) {
    error('--interrupt-after requires --record')
  }
  const prompt = args.length === 0 ? undefined : args.join(' ')
  if (prompt !== undefined && prompt.trim() === '') {
    error('a prompt must contain non-whitespace text')
  }
  if (record !== undefined && prompt === undefined) {
    error('--record requires a prompt to drive the recorded turn')
  }
  return { resume, resumePicker, model, reasoningEffort, theme, preset, prompt, record, interruptAfterMs }
}

/**
 * Parse and provide the startup values as an ordinary Cordis service. The
 * command's action publishes the values; help and rejections owe the process
 * an exit, which `parseCmdline` requests from the launcher.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    ctx.provide(
      TUI_STARTUP_SERVICE,
      valuesFromOptions(program.opts<TuiOptions>(), program.args, message => program.error(`error: ${message}`)),
    )
  })
  parseCmdline(ctx, program)
}

/**
 * Parse an argument snapshot without a Cordis context (unit tests).
 * @param argv - raw inner arguments, as `ctx.cmdlineArgs` would return them.
 * @returns the parsed startup values.
 * @throws commander's control-flow error on help, version, or a rejection.
 */
export function parseTuiArgs(argv: readonly string[]): TuiStartupValues {
  const program = tuiCommand().exitOverride()
  let captured: TuiStartupValues | undefined
  program.action(() => {
    captured = valuesFromOptions(program.opts<TuiOptions>(), program.args, message => program.error(`error: ${message}`))
  })
  program.parse([...argv], { from: 'user' })
  if (captured === undefined) {
    throw new Error('dsh-tui startup: parse completed without publishing values')
  }
  return captured
}
