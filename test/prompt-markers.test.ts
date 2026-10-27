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

  it('renders the startup banner: the whale carries the brand block', () => {
    const model = new TranscriptModel()
    model.pushBanner('v0.1.0', 'DeepSeek Harness TUI', 'Developed by Vibe Terminal', 'model p/m · type / for commands')
    const lines = new TranscriptView(model.items, context).render(80)
    const version = lines.find(line => line.includes('v0.1.0'))
    const title = lines.find(line => line.includes('DeepSeek Harness TUI'))
    const subtitle = lines.find(line => line.includes('Developed by Vibe Terminal'))
    expect(version).toBeDefined()
    expect(title).toBeDefined()
    expect(subtitle).toBeDefined()
    // Version rides above the title, the title above the subtitle.
    expect(lines.indexOf(version!)).toBe(lines.indexOf(title!) - 1)
    expect(lines.indexOf(title!)).toBe(lines.indexOf(subtitle!) - 1)
    // The half-block whale art is present and styled (brand color or accent).
    const art = lines.find(line => /\x1b\[(?:38;2;\d+;\d+;\d+|36)m[▀▄█]/.test(line))
    expect(art).toBeDefined()
    expect(art).toContain('▄')
  })
})
