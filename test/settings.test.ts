import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadTuiSettings, saveTuiSettings, tuiSettingsPath } from '../src/settings.ts'

const previousHome = process.env.DSH_HOME

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

/** Run the body with $DSH_HOME pointed at a temp directory. */
async function withTempHome(body: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tui-settings-'))
  process.env.DSH_HOME = dir
  try {
    await body()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('persisted settings', () => {
  it('round-trips preset, theme, and locale under $DSH_HOME/tui/settings.json', () => withTempHome(async () => {
    await saveTuiSettings({ preset: 'ptc', theme: 'light', locale: 'zh' })
    expect(tuiSettingsPath()).toBe(join(process.env.DSH_HOME as string, 'tui', 'settings.json'))
    await expect(loadTuiSettings()).resolves.toEqual({ preset: 'ptc', theme: 'light', locale: 'zh' })
  }))

  it('returns {} when no settings file exists', () => withTempHome(async () => {
    await expect(loadTuiSettings()).resolves.toEqual({})
  }))

  it('returns {} on corrupt JSON instead of throwing', () => withTempHome(async () => {
    const file = tuiSettingsPath()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, '{ not json ]', 'utf8')
    await expect(loadTuiSettings()).resolves.toEqual({})
  }))

  it('keeps only non-blank string fields and drops everything else', () => withTempHome(async () => {
    const file = tuiSettingsPath()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({
      preset: 'minimal',
      theme: '  ',
      locale: 42,
      junk: { nested: true },
    }), 'utf8')
    await expect(loadTuiSettings()).resolves.toEqual({ preset: 'minimal' })
  }))

  it('overwrites atomically: a re-save replaces the previous content', () => withTempHome(async () => {
    await saveTuiSettings({ preset: 'ptc', theme: 'dark' })
    await saveTuiSettings({ preset: 'cordis' })
    const raw = await readFile(tuiSettingsPath(), 'utf8')
    expect(JSON.parse(raw)).toEqual({ preset: 'cordis' })
  }))
})
