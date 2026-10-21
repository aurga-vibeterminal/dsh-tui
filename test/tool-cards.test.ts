/**
 * Tool-card tests: presenter-fed views land on tool items, detail renderers
 * stay within width, and the expand toggles behave.
 */
import { describe, expect, it } from 'vitest'
import { TranscriptModel, type ToolPresenter } from '../src/events.ts'
import { TranscriptView, type ItemContext } from '../src/components/transcript.ts'
import { markdownThemeFor, themeByName } from '../src/theme.ts'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const theme = themeByName('dark')
const context: ItemContext = { theme, markdownTheme: markdownThemeFor(theme) }

const presenter: ToolPresenter = {
  callView: (name) => {
    if (name === 'edit') {
      return {
        card: 'diff',
        title: 'Edit src/app.ts',
        diffs: [{ path: 'src/app.ts', oldText: 'const a = 1\nconst b = 2\n', newText: 'const a = 1\nconst b = 3\nconst c = 4\n' }],
      }
    }
    return undefined
  },
  resultView: (name) => {
    if (name === 'edit') {
      return { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: 'const a = 1\nconst b = 2\n', newText: 'const a = 1\nconst b = 3\nconst c = 4\n' }] }
    }
    if (name === 'read') {
      return {
        card: 'read',
        path: 'package.json',
        offset: 1,
        totalLines: 30,
        lines: [
          { number: 1, text: '{' },
          { number: 2, text: '  "name": "dsh-tui"' },
          { number: 3, text: '}' },
        ],
      }
    }
    if (name === 'glob') {
      return { card: 'search', shape: 'paths', paths: ['README.md', 'docs/PLAN.md'], truncated: false, total: 2 }
    }
    return undefined
  },
}

function applyToolPair(model: TranscriptModel, name: string, args: string): void {
  model.applyEvent({
    type: 'tool/call', seq: 1, time: 0,
    data: { callId: 'c1', name, arguments: args },
  } as unknown as SessionEvent)
  model.applyEvent({
    type: 'tool/result', seq: 2, time: 0,
    data: { turn: 1, step: 1, meta: undefined, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'done' }], isError: false, id: 'r1' } },
  } as unknown as SessionEvent)
}

describe('tool cards · presenter integration', () => {
  it('attaches call and result views from the presenter', () => {
    const model = new TranscriptModel(presenter)
    applyToolPair(model, 'edit', '{"path":"src/app.ts"}')
    const tool = model.items.find(item => item.kind === 'tool')
    expect(tool).toMatchObject({ kind: 'tool', status: 'ok' })
    expect((tool as { callView?: { card: string } }).callView).toMatchObject({ card: 'diff' })
    expect((tool as { resultView?: { card: string } }).resultView).toMatchObject({ card: 'diff' })
  })

  it('renders diff detail cards with +/- lines within width', () => {
    const model = new TranscriptModel(presenter)
    applyToolPair(model, 'edit', '{"path":"src/app.ts"}')
    model.toggleLastToolDetails()
    const view = new TranscriptView(model.items, context)
    const lines = view.render(80)
    const joined = lines.join('\n')
    expect(joined).toContain('Edit src/app.ts')
    expect(joined).toContain('- const b = 2')
    expect(joined).toContain('+ const b = 3')
    expect(joined).toContain('+ const c = 4')
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80)
  })

  it('renders read cards with line numbers and search cards with paths', () => {
    const readModel = new TranscriptModel(presenter)
    applyToolPair(readModel, 'read', '{"path":"package.json"}')
    readModel.toggleLastToolDetails()
    const readLines = new TranscriptView(readModel.items, context).render(80).join('\n')
    expect(readLines).toContain('package.json')
    expect(readLines).toContain('"name": "dsh-tui"')
    // Strip ANSI styling before asserting the line-number gutter shape.
    const plain = readLines.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toMatch(/\d+ │ \{/)

    const globModel = new TranscriptModel(presenter)
    applyToolPair(globModel, 'glob', '{"pattern":"*.md"}')
    globModel.toggleLastToolDetails()
    const globLines = new TranscriptView(globModel.items, context).render(80).join('\n')
    expect(globLines).toContain('README.md')
    expect(globLines).toContain('docs/PLAN.md')
  })

  it('toggles the last tool and all tools', () => {
    const model = new TranscriptModel(presenter)
    applyToolPair(model, 'glob', '{"pattern":"*.md"}')
    const tool = model.items.find(item => item.kind === 'tool') as { expanded: boolean }
    expect(tool.expanded).toBe(false)
    model.toggleLastToolDetails()
    expect(tool.expanded).toBe(true)
    model.toggleAllToolDetails()
    expect(tool.expanded).toBe(false)
    model.toggleAllToolDetails()
    expect(tool.expanded).toBe(true)
  })
})
