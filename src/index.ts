/**
 * dsh-tui runner — Phase 0 walking skeleton.
 *
 * Boots after the loader settles, prints the resolved startup values and the
 * profile's default model selection, then exits through the launcher. This
 * proves the addon contract end to end (profile boot, row injection, service
 * wiring, peer resolution, `ctx.appExit`); Phase 1 replaces the body with the
 * interactive terminal loop.
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

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Services required before the skeleton can run. */
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
}

export const Config: z<Config> = z.object({
  resume: z.string(),
  model: z.string(),
  theme: z.string(),
  prompt: z.string(),
  record: z.string(),
})

/** The default model selection's observable shape. */
interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string | undefined
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
      await recordFixture(ctx, { outDir: config.record, prompt: config.prompt })
      process.stdout.write(`dsh-tui: fixture recorded to ${config.record}\n`)
      exit(0)
      return
    }

    // Every sibling row settles before the app takes over the process.
    await ctx.get('loader')?.await()
    const selection = ctx.get('agentDefaultModel')?.currentSelection() as ModelSelection | undefined
    const effort = selection?.reasoningEffort
    const lines = [
      'dsh-tui 0.0.1 (phase 0 skeleton)',
      `  theme    : ${config.theme ?? 'dark'}`,
      `  resume   : ${config.resume ?? '(fresh session)'}`,
      `  model    : ${config.model ?? '(profile default)'}`,
      `  cwd      : ${process.cwd()}`,
      `  selection: ${selection === undefined ? '(unavailable)' : `${selection.provider}/${selection.model}${effort === undefined || effort === '' ? '' : ` effort=${effort}`}`}`,
    ]
    process.stdout.write(`${lines.join('\n')}\n`)
    exit(0)
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`dsh-tui: ${message}\n`)
    exit(1)
  })
}
