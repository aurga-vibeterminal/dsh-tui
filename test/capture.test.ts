import { describe, expect, it } from 'vitest'
import { StderrCapture } from '../src/util/log.ts'

const noopLogger = { debug: () => {} }

describe('StderrCapture', () => {
  it('captures console.info output instead of writing it, and restores both channels', () => {
    const capture = new StderrCapture(noopLogger)
    const originalInfo = console.info
    const originalError = console.error

    capture.install()
    expect(console.info).not.toBe(originalInfo)
    // Must not throw; output goes to the logger, not the terminal.
    expect(() => {
      console.info('[tag]', 'model listing loaded', { count: 2 })
      console.warn('[tag]', 'something odd')
      process.stderr.write('stray stderr\n')
    }).not.toThrow()
    console.info('still captured')

    const pending = capture.restore()
    expect(console.info).toBe(originalInfo)
    expect(console.error).toBe(originalError)
    expect(pending).toBe('stray stderr\n')

    // After restore, writes flow normally again (and restore is idempotent).
    expect(capture.restore()).toBe('')
  })
})
