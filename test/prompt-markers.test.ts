import { describe, expect, it } from 'vitest'
import { TranscriptModel } from '../src/events.ts'
import { TranscriptView, type ItemContext } from '../src/components/transcript.ts'
import { markdownThemeFor, themeByName } from '../src/theme.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const theme = themeByName('dark')
const context: ItemContext = { theme, markdownTheme: markdownThemeFor(theme) }

describe('prompt markers', () => {
  it('marks user lines with OSC 133 for Ctrl+Up/Down jumps, and only user lines', () => {
    const model = new TranscriptModel()
    model.applyEvent({
      type: 'user/message', seq: 1, time: 0,
      data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' }, role: 'user', id: 'u1' },
    } as unknown as SessionEvent)
    model.applyEvent({
      type: 'assistant/message', seq: 2, time: 0,
      data: { message: { content: [{ type: 'text', text: 'hi' }], source: {} }, usage: { inputTokens: 1, outputTokens: 1 } },
    } as unknown as SessionEvent)

    const lines = new TranscriptView(model.items, context).render(60)
    const userLine = lines.find(line => line.includes('hello'))
    const assistantLine = lines.find(line => line.includes('hi'))
    expect(userLine).toBeDefined()
    expect(userLine!.startsWith('\x1b]133;A\x07')).toBe(true)
    expect(assistantLine === undefined || !assistantLine.startsWith('\x1b]133;A\x07')).toBe(true)
  })
})
