import { describe, expect, it } from 'vitest'
import { fuzzyFileItems } from '../src/components/file-search.ts'

describe('fuzzyFileItems (fd-free @ fallback)', () => {
  it('fuzzy-finds project files and returns completion items', () => {
    const items = fuzzyFileItems(process.cwd(), 'PLAN')
    expect(items.length).toBeGreaterThan(0)
    const plan = items.find(item => item.description.includes('PLAN'))
    expect(plan).toBeDefined()
    expect(plan!.value).toContain('@')
    expect(plan!.label).toContain('PLAN')
  })

  it('prefixes every value with @ and prefers name matches over deep paths', () => {
    const items = fuzzyFileItems(process.cwd(), 'json')
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(item.value.startsWith('@')).toBe(true)
  })

  it('returns a bounded list for an empty query', () => {
    const items = fuzzyFileItems(process.cwd(), '@')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(20)
  })

  it('skips node_modules and build output', () => {
    const items = fuzzyFileItems(process.cwd(), '')
    const all = items.map(item => item.description).join('\n')
    expect(all).not.toContain('node_modules/')
  })
})
