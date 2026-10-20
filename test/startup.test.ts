import { describe, expect, it } from 'vitest'
import { parseTuiArgs } from '../src/startup.ts'

const absent = {
  resume: undefined,
  model: undefined,
  reasoningEffort: undefined,
  theme: undefined,
  prompt: undefined,
  record: undefined,
  interruptAfterMs: undefined,
}

describe('parseTuiArgs', () => {
  it('parses an empty invocation into all-absent values', () => {
    expect(parseTuiArgs([])).toEqual(absent)
  })

  it('parses every flag', () => {
    expect(
      parseTuiArgs(['--resume', 'session-abc', '--model', 'deepseek-official/deepseek-flash', '--reasoning-effort', 'max', '--theme', 'light']),
    ).toEqual({
      ...absent,
      resume: 'session-abc',
      model: { provider: 'deepseek-official', model: 'deepseek-flash' },
      reasoningEffort: 'max',
      theme: 'light',
    })
  })

  it('joins a multi-word positional prompt', () => {
    expect(parseTuiArgs(['hello', 'dsh', 'world'])).toEqual({ ...absent, prompt: 'hello dsh world' })
  })

  it('parses the record mode with its prompt', () => {
    expect(parseTuiArgs(['--record', 'test/fixtures/x', 'drive', 'the', 'turn'])).toEqual({
      ...absent,
      record: 'test/fixtures/x',
      prompt: 'drive the turn',
    })
  })

  it('splits the model route only on the first slash', () => {
    expect(parseTuiArgs(['--model', 'p/m/x'])).toEqual({
      ...absent,
      model: { provider: 'p', model: 'm/x' },
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
    expect(() => parseTuiArgs(['--record', ' '])).toThrow()
  })

  it('rejects record mode without a prompt', () => {
    expect(() => parseTuiArgs(['--record', 'test/fixtures/x'])).toThrow()
  })

  it('rejects unknown options', () => {
    expect(() => parseTuiArgs(['--nope'])).toThrow()
  })
})
