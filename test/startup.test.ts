import { describe, expect, it } from 'vitest'
import { parseTuiArgs } from '../src/startup.ts'

describe('parseTuiArgs', () => {
  it('parses an empty invocation into all-absent values', () => {
    expect(parseTuiArgs([])).toEqual({
      resume: undefined,
      model: undefined,
      reasoningEffort: undefined,
      theme: undefined,
    })
  })

  it('parses every flag', () => {
    expect(
      parseTuiArgs(['--resume', 'session-abc', '--model', 'deepseek-official/deepseek-flash', '--reasoning-effort', 'max', '--theme', 'light']),
    ).toEqual({
      resume: 'session-abc',
      model: { provider: 'deepseek-official', model: 'deepseek-flash' },
      reasoningEffort: 'max',
      theme: 'light',
    })
  })

  it('splits the model route only on the first slash', () => {
    expect(parseTuiArgs(['--model', 'p/m/x'])).toEqual({
      resume: undefined,
      model: { provider: 'p', model: 'm/x' },
      reasoningEffort: undefined,
      theme: undefined,
    })
  })

  it('rejects a model without a provider or model part', () => {
    expect(() => parseTuiArgs(['--model', 'onlymodel'])).toThrow()
    expect(() => parseTuiArgs(['--model', '/model'])).toThrow()
    expect(() => parseTuiArgs(['--model', 'provider/'])).toThrow()
  })

  it('rejects empty flag values', () => {
    expect(() => parseTuiArgs(['--resume', '  '])).toThrow()
    expect(() => parseTuiArgs(['--theme', ''])).toThrow()
    expect(() => parseTuiArgs(['--reasoning-effort', ''])).toThrow()
  })

  it('rejects unknown options', () => {
    expect(() => parseTuiArgs(['--nope'])).toThrow()
  })
})
