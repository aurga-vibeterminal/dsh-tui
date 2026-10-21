/**
 * Dialog tests: key handling, signal cancellation, and overlay focus routing
 * for the approval and user-question answerers.
 */
import { describe, expect, it } from 'vitest'
import { TuiAltScreen, type Component } from '@earendil-works/pi-tui'
import { ApprovalDialog, EventsDialog, QuestionDialog } from '../src/dialogs.ts'
import { StatusLine } from '../src/components/status-line.ts'
import { themeByName } from '../src/theme.ts'
import { HeadlessTerminal } from './helpers/headless-terminal.ts'

const theme = themeByName('dark')
const flush = async (term: HeadlessTerminal, ms = 30): Promise<void> => {
  await new Promise<void>(resolve => setTimeout(resolve, ms))
  await term.settled()
}

describe('ApprovalDialog', () => {  it('renders the tool, reason, and key hints within the width', () => {
    const dialog = new ApprovalDialog({ toolName: 'bash', reason: 'rm -rf build' }, theme)
    const lines = dialog.render(48)
    expect(lines.length).toBe(3)
    expect(lines[0]).toContain('approve bash')
    expect(lines[1]).toContain('rm -rf build')
    expect(lines[2]).toContain('y allow once')
  })

  it('resolves y / enter → allowed-once, n / esc → rejected, ctrl+c → cancelled', async () => {
    for (const [input, expected] of [['y', 'allowed-once'], ['\r', 'allowed-once'], ['n', 'rejected'], ['\x1b', 'rejected'], ['\x03', 'cancelled']] as const) {
      const dialog = new ApprovalDialog({ toolName: 'bash' }, theme)
      dialog.handleInput(input)
      expect(await dialog.done).toBe(expected)
    }
  })

  it('resolves cancelled when the request signal aborts', async () => {
    const controller = new AbortController()
    const dialog = new ApprovalDialog({ toolName: 'bash', signal: controller.signal }, theme)
    controller.abort()
    expect(await dialog.done).toBe('cancelled')
  })
})

describe('QuestionDialog', () => {
  const questions = [
    { id: 'scope', question: 'Which scope?', options: [{ label: 'src' }, { label: 'test' }] },
    { id: 'modes', question: 'Which modes?', multiSelect: true, options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] },
  ]

  it('single-select submits the highlighted option and advances', async () => {
    const dialog = new QuestionDialog({ questions }, theme)
    // Move down once in the first question, then enter selects 'test'.
    dialog.handleInput('\x1b[B')
    dialog.handleInput('\r')
    // Second question: multi-select — toggle two, then submit with enter.
    dialog.handleInput(' ')
    dialog.handleInput('\x1b[B')
    dialog.handleInput(' ')
    dialog.handleInput('\r')
    const answer = await dialog.done
    expect(answer.answers).toEqual([
      { id: 'scope', selected: ['test'] },
      { id: 'modes', selected: ['a', 'b'] },
    ])
  })

  it('esc cancels with an empty answer', async () => {
    const dialog = new QuestionDialog({ questions }, theme)
    dialog.handleInput('\x1b')
    expect(await dialog.done).toEqual({ answers: [] })
  })

  it('tab cycles questions without answering', () => {
    const dialog = new QuestionDialog({ questions }, theme)
    const first = dialog.render(40)
    dialog.handleInput('\t')
    const second = dialog.render(40)
    expect(second.join('\n')).toContain('Which modes?')
    expect(second.join('\n')).not.toContain('Which scope?')
    expect(first.join('\n')).toContain('Which scope?')
  })
})

describe('StatusLine spinner', () => {
  it('prepends spinner frames only while active, and stops cleanly', async () => {
    let renders = 0
    const line = new StatusLine(() => { renders += 1 }, 10)
    const idle = line.render(40)
    expect(idle[0]).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)

    line.set('working', true)
    const first = line.render(40)[0]
    expect(first).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)
    expect(first).toContain('working')

    await new Promise<void>(resolve => setTimeout(resolve, 35))
    const spun = line.render(40)[0]
    expect(renders).toBeGreaterThan(0)
    expect(spun).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)

    line.dispose()
    const settled = line.render(40)[0]
    expect(settled).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)
    expect(settled).toContain('working')
  })
})

describe('EventsDialog', () => {
  it('renders recent raw events with seq, type, and summary', () => {
    const records = [
      { seq: 8, type: 'user/message', summary: '{"content":[]}' },
      { seq: 9, type: 'assistant/message', summary: '{"usage":{}}' },
    ]
    const dialog = new EventsDialog(records, theme)
    const lines = dialog.render(64)
    expect(lines[0]).toContain('raw events')
    expect(lines[1]).toContain('8 user/message')
    expect(lines[2]).toContain('9 assistant/message')
    expect(lines.at(-1)).toContain('esc close')
  })

  it('closes on escape, enter, or q', async () => {
    for (const key of ['\x1b', '\r', 'q']) {
      const dialog = new EventsDialog([], theme)
      dialog.handleInput(key)
      await dialog.done
    }
  })
})

describe('dialogs over TuiAltScreen overlays', () => {
  it('receives keys through the terminal and resolves', async () => {
    const term = new HeadlessTerminal(60, 16)
    const tui = new TuiAltScreen(term)
    tui.start()
    await flush(term)

    const dialog: Component & { readonly done: Promise<string> } = new ApprovalDialog({ toolName: 'bash', reason: 'run tests' }, theme) as unknown as Component & { readonly done: Promise<string> }
    const handle = tui.showOverlay(dialog, { width: '100%', anchor: 'bottom-left', margin: 0 })
    tui.requestRender()
    await flush(term)

    // The overlay is focused: a 'y' keypress resolves the dialog.
    term.send('y')
    await flush(term)
    handle.hide()
    tui.requestRender()
    await flush(term)

    expect(await (dialog as { done: Promise<string> }).done).toBe('allowed-once')
    tui.stop()
    await flush(term)
  })
})
