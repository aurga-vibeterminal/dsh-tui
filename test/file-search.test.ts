import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fuzzyFileItems } from '../src/components/file-search.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A temp tree with known files, so the tests never depend on repo contents. */
async function fixtureTree(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tui-fsearch-'))
  await writeFile(join(root, 'PLAN.md'), '# plan')
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'plan-utils.ts'), 'export {}')
  await mkdir(join(root, 'node_modules'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'dep', 'PLAN-junk.md'), 'junk')
  return root
}

describe('fuzzyFileItems (fd-free @ fallback)', () => {
  it('fuzzy-finds tree files and returns completion items', async () => {
    const items = fuzzyFileItems(await fixtureTree(), 'PLAN')
    expect(items.length).toBeGreaterThan(0)
    const plan = items.find(item => item.description.includes('PLAN'))
    expect(plan).toBeDefined()
    expect(plan!.value).toContain('@')
    expect(plan!.label).toContain('PLAN')
  })

  it('prefixes every value with @ for a plain query', async () => {
    const items = fuzzyFileItems(await fixtureTree(), 'plan')
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(item.value.startsWith('@')).toBe(true)
  })

  it('returns a bounded list for an empty query', async () => {
    const items = fuzzyFileItems(await fixtureTree(), '@')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(20)
  })

  it('skips node_modules and build output', async () => {
    const items = fuzzyFileItems(await fixtureTree(), 'PLAN')
    const all = items.map(item => item.description).join('\n')
    expect(all).not.toContain('node_modules')
  })
})
