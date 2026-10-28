import { describe, expect, it } from 'vitest'

// expandSkillReferences lives in the app module; import it directly.
import { expandSkillReferences } from '../src/app.ts'

const roster = [
  { name: 'diagnose-windows-sandbox-acl' },
  { name: 'pdf-export' },
]

describe('expandSkillReferences', () => {
  it('expands known skill names at any word boundary', () => {
    expect(expandSkillReferences('用 #pdf-export 处理这份报告', roster))
      .toBe('用 <skill>pdf-export</skill> 处理这份报告')
    expect(expandSkillReferences('#diagnose-windows-sandbox-acl 排查一下', roster))
      .toBe('<skill>diagnose-windows-sandbox-acl</skill> 排查一下')
  })

  it('expands multiple references in one message', () => {
    expect(expandSkillReferences('#pdf-export 然后 #diagnose-windows-sandbox-acl', roster))
      .toBe('<skill>pdf-export</skill> 然后 <skill>diagnose-windows-sandbox-acl</skill>')
  })

  it('leaves unknown names, hashtags, and code alone', () => {
    const text = 'see #todo and C# and #not-a-skill here'
    expect(expandSkillReferences(text, roster)).toBe(text)
  })

  it('does not expand inside words or paths', () => {
    const text = 'path/to/#pdf-export.md and a#pdf-export stay'
    expect(expandSkillReferences(text, roster)).toBe(text)
  })

  it('skips work when no # exists', () => {
    expect(expandSkillReferences('plain text', roster)).toBe('plain text')
  })
})
