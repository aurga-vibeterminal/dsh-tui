import { describe, expect, it } from 'vitest'

import { CombinedAutocompleteProvider, type AutocompleteProvider } from '@earendil-works/pi-tui'

// ComposerAutocomplete lives in the app module; import it directly.
import { ComposerAutocomplete, type ComposerCommand } from '../src/app.ts'

const PALETTE: readonly ComposerCommand[] = [
  { name: 'exit', description: 'quit the TUI', aliases: ['quit'] },
  { name: 'clear', description: 'clear the transcript view' },
  { name: 'session', description: 'list stored sessions and switch to one', aliases: ['resume', 'sessions'] },
  { name: 'thinking', description: 'switch the reasoning level', aliases: ['effort'] },
]

/** Builds the composer provider; the inner provider may be a passive stub. */
function makeComposer(inner?: AutocompleteProvider): ComposerAutocomplete {
  return new ComposerAutocomplete(
    (inner ?? { getSuggestions: async () => null }) as unknown as CombinedAutocompleteProvider,
    process.cwd(),
    null,
    () => [],
    () => PALETTE,
  )
}

const SIGNAL = { signal: new AbortController().signal }

describe('ComposerAutocomplete slash palette', () => {
  it('lists each command once — aliases never appear as their own rows', async () => {
    const suggestions = await makeComposer().getSuggestions(['/'], 0, 1, SIGNAL)
    const names = suggestions?.items.map((item) => item.value) ?? []
    expect(names).toEqual(['exit', 'clear', 'session', 'thinking'])
    expect(names).not.toContain('quit')
    expect(names).not.toContain('resume')
  })

  it('matches a typed alias and labels the row "name (alias)"', async () => {
    const suggestions = await makeComposer().getSuggestions(['/res'], 0, 4, SIGNAL)
    expect(suggestions?.prefix).toBe('/res')
    expect(suggestions?.items[0]).toEqual({
      value: 'session',
      label: 'session (resume)',
      description: 'list stored sessions and switch to one',
    })
  })

  it('matches a fully typed alias too', async () => {
    const suggestions = await makeComposer().getSuggestions(['/quit'], 0, 5, SIGNAL)
    expect(suggestions?.items[0]?.value).toBe('exit')
    expect(suggestions?.items[0]?.label).toBe('exit (quit)')
  })

  it('keeps the plain label for primary-name matches', async () => {
    const suggestions = await makeComposer().getSuggestions(['/exi'], 0, 4, SIGNAL)
    expect(suggestions?.items[0]?.value).toBe('exit')
    expect(suggestions?.items[0]?.label).toBe('exit')
  })

  it('completes an alias-typed prefix to the primary name', async () => {
    const composer = makeComposer(new CombinedAutocompleteProvider([...PALETTE], process.cwd(), null))
    const applied = composer.applyCompletion(['/res'], 0, 4, { value: 'session', label: 'session (resume)' }, '/res')
    expect(applied.lines[0]).toBe('/session ')
    expect(applied.cursorCol).toBe('/session '.length)
  })

  it('skips the command branch for forced (Tab) completion', async () => {
    // A stubbed inner returning null proves the slash palette did not answer.
    expect(await makeComposer().getSuggestions(['/'], 0, 1, { ...SIGNAL, force: true })).toBeNull()
  })

  it('returns null when nothing matches', async () => {
    expect(await makeComposer().getSuggestions(['/zzz'], 0, 4, SIGNAL)).toBeNull()
  })
})
