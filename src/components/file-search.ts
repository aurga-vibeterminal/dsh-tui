/**
 * File-search backing for the composer's `@` fuzzy completion.
 *
 * pi-tui's CombinedAutocompleteProvider requires the `fd` binary for fuzzy
 * file search (`getFuzzyFileSuggestions` returns nothing without `fdPath`),
 * which is often absent on Windows. We resolve `fd` when available and keep a
 * bounded pure-JS walk as the fallback so `@` works out of the box.
 * @module dsh-tui/components/file-search
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fuzzyFilter } from '@earendil-works/pi-tui'

/** One completion item in the shape the combined provider applies. */
export interface FileSuggestionItem {
  value: string
  label: string
  description: string
}

const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'lib', 'build', 'out',
  'coverage', 'target', '__pycache__', '.dsh-test', '.pnpm-store', '.venv', 'venv',
])

const WALK_ENTRY_LIMIT = 4000
const WALK_DEPTH_LIMIT = 8
const CACHE_TTL_MS = 30_000

let cachedFdPath: string | null | undefined

/** Resolve the `fd` binary once; null when unavailable. */
export function resolveFdPath(): string | null {
  if (cachedFdPath !== undefined) return cachedFdPath
  try {
    // `where` on Windows, `which` elsewhere; both print matches one per line.
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const output = execFileSync(finder, ['fd'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const first = output.split('\n').map(line => line.trim()).find(line => line !== '')
    cachedFdPath = first ?? null
  } catch {
    cachedFdPath = null
  }
  return cachedFdPath
}

interface WalkCache {
  at: number
  entries: { path: string, isDirectory: boolean }[]
}

let cache: WalkCache | undefined
let cacheBase: string | undefined

/** Fuzzy file items over a bounded walk of the workspace (fd-free fallback). */
export function fuzzyFileItems(basePath: string, query: string): FileSuggestionItem[] {
  const now = Date.now()
  if (cache === undefined || cacheBase !== basePath || now - cache.at > CACHE_TTL_MS) {
    const entries: { path: string, isDirectory: boolean }[] = []
    collectEntries(basePath, '', entries, 0)
    cache = { at: now, entries }
    cacheBase = basePath
  }
  const candidates = cache.entries.map(entry => ({
    ...entry,
    name: entry.path.split('/').pop() ?? entry.path,
  }))
  const needle = query.replace(/^@/, '')
  const matched = needle === ''
    ? candidates.slice(0, 20)
    : fuzzyFilter(candidates, needle, entry => entry.name)
  return matched.slice(0, 20).map(entry => {
    const displayPath = entry.path
    const label = entry.isDirectory ? `${entry.name}/` : entry.name
    return {
      value: `@${entry.isDirectory ? `${displayPath}/` : displayPath}`,
      label,
      description: displayPath,
    }
  })
}

function collectEntries(root: string, relative: string, out: { path: string, isDirectory: boolean }[], depth: number): void {
  if (out.length >= WALK_ENTRY_LIMIT || depth > WALK_DEPTH_LIMIT) return
  let names: string[]
  try {
    names = readdirSync(join(root, relative))
  } catch {
    return
  }
  for (const name of names) {
    if (out.length >= WALK_ENTRY_LIMIT) return
    if (name.startsWith('.') && name !== '.github') continue
    if (SKIP_DIRECTORIES.has(name)) continue
    const childRelative = relative === '' ? name : `${relative}/${name}`
    let isDirectory: boolean
    try {
      isDirectory = statSync(join(root, childRelative)).isDirectory()
    } catch {
      continue
    }
    out.push({ path: childRelative, isDirectory })
    if (isDirectory) collectEntries(root, childRelative, out, depth + 1)
  }
}
