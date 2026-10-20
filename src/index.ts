/**
 * dsh-tui runner — the app plugin.
 *
 * Two modes, switched by the startup provider's flags:
 * - `--record <dir> "<prompt>"` — dev fixture recording (src/recorder.ts).
 * - interactive fullscreen session (src/app.ts), the product.
 * Both exit through the launcher's `ctx.appExit`.
 * @module dsh-tui
 */

import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only Context merges: the loader service, the cmdline host values
// (appExit), and the default-model service read below.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { recordFixture } from './recorder.ts'
import type { DriverModelRoute } from './agent-driver.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Services required before the app can run. */
export const inject = ['agentDefaultModel']

/** Plugin config: values the bundle patch forwards from the startup service. */
export interface Config {
  /** Persisted Session id to resume; absent for a fresh session. */
  resume?: string
  /** Explicit `provider/model` route; absent keeps the default selection. */
  model?: string
  /** UI theme name. */
  theme?: string
  /** Initial prompt text (used by --record). */
  prompt?: string
  /** Dev tooling: record one turn's raw events into this directory, then exit. */
  record?: string
  /** Dev tooling: with --record, interrupt the turn after this many ms. */
  interruptAfterMs?: number
}

export const Config: z<Config> = z.object({
  resume: z.string(),
  model: z.string(),
  theme: z.string(),
  prompt: z.string(),
  record: z.string(),
  interruptAfterMs: z.number(),
})

/** Split one `provider/model` config string into its route parts. */
function parseModelRoute(raw: string): DriverModelRoute {
  const separator = raw.indexOf('/')
  return { provider: raw.slice(0, separator), model: raw.slice(separator + 1) }
}

export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  void (async (): Promise<void> => {
    // Dev tooling: fixture recording mode (see src/recorder.ts).
    if (config.record !== undefined) {
      if (config.prompt === undefined || config.prompt.trim() === '') {
        throw new Error('tui-runner: --record requires a prompt')
      }
      await recordFixture(ctx, {
        outDir: config.record,
        prompt: config.prompt,
        interruptAfterMs: config.interruptAfterMs,
      })
      process.stdout.write(`dsh-tui: fixture recorded to ${config.record}\n`)
      exit(0)
      return
    }

    // Interactive fullscreen session.
    if (process.stdin.isTTY !== true) {
      throw new Error('tui: an interactive terminal is required (stdin is not a TTY)')
    }
    const { TuiApp } = await import('./app.ts')
    const app = await TuiApp.create(ctx, {
      resume: config.resume,
      model: config.model === undefined ? undefined : parseModelRoute(config.model),
      theme: config.theme,
      prompt: config.prompt,
    })
    const result = await app.run(config.prompt)
    exit(result.exitCode)
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`dsh-tui: ${message}\n`)
    exit(1)
  })
}
