/**
 * Persisted dsh-tui user settings: `$DSH_HOME/tui/settings.json` (the home
 * follows `DSH_HOME`, defaulting to `~/.dsh`). The preset / theme / locale
 * choices made with `/preset`, `/theme`, and `/language` survive restarts.
 * CLI flags keep the highest precedence at boot; the file only records what
 * the runtime commands change.
 * @module dsh-tui/settings
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** String-valued settings persisted across restarts. */
export interface TuiSettings {
  /** Default agent preset for newly materialized sessions. */
  preset?: string
  /** UI theme name (`dark` | `light`). */
  theme?: string
  /** UI locale id (`en` | `zh`). */
  locale?: string
  /** Default model route for new sessions, as `provider/model`. */
  model?: string
}

const SETTING_KEYS: readonly (keyof TuiSettings)[] = ['preset', 'theme', 'locale', 'model']

/** Absolute settings-file path under the resolved harness home. */
export function tuiSettingsPath(): string {
  return dshHomePath('tui', 'settings.json')
}

/**
 * Read the settings file. A missing file, unreadable bytes, or corrupt JSON
 * all yield `{}` — a broken settings file must never block the TUI from
 * starting; it is simply rewritten on the next change.
 */
export async function loadTuiSettings(): Promise<TuiSettings> {
  let raw: string
  try {
    raw = await readFile(tuiSettingsPath(), 'utf8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const record = parsed as Record<string, unknown>
  const settings: TuiSettings = {}
  for (const key of SETTING_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') settings[key] = value.trim()
  }
  return settings
}

/**
 * Atomically write the settings file (temp file + rename), creating parent
 * directories on demand. Callers handle failures (a notice, a debug log).
 */
export async function saveTuiSettings(settings: TuiSettings): Promise<void> {
  const file = tuiSettingsPath()
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}
