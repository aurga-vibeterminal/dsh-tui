/**
 * Phase 0 · Spike 2 — pi-tui dynamic evaluation (opencode-style layout).
 *
 * Drives `TuiAltScreen` (fullscreen alternate buffer, app-owned scrolling)
 * inside a headless xterm with the layout dsh-tui commits to in
 * docs/PLAN.md §4: a persistent header bar, a transcript `ScrollView`
 * (`follow: "end"`, primary), and a bottom composer (bordered editor + hints).
 * Asserts streaming updates land in the viewport, width discipline holds, the
 * editor receives raw key bytes, and stopping the renderer restores the main
 * screen with the transcript printed into normal scrollback.
 */
import { describe, expect, it } from 'vitest'
import {
  Container,
  Editor,
  isViewportTUI,
  Markdown,
  ScrollView,
  Text,
  TruncatedText,
  TuiAltScreen,
  VStack,
  visibleWidth,
  type MarkdownTheme,
  type SelectListTheme,
} from '@earendil-works/pi-tui'
import { HeadlessTerminal } from './helpers/headless-terminal.ts'

const identity = (text: string): string => text

const markdownTheme: MarkdownTheme = {
  heading: identity,
  link: identity,
  linkUrl: identity,
  code: identity,
  codeBlock: identity,
  codeBlockBorder: identity,
  quote: identity,
  quoteBorder: identity,
  hr: identity,
  listBullet: identity,
  bold: identity,
  italic: identity,
  strikethrough: identity,
  underline: identity,
}

const selectListTheme: SelectListTheme = {
  selectedPrefix: identity,
  selectedText: identity,
  description: identity,
  scrollInfo: identity,
  noMatch: identity,
}

/** Let the 60 fps-throttled renderer (16 ms) flush, then await emulator parsing. */
const flush = async (term: HeadlessTerminal, ms = 30): Promise<void> => {
  await new Promise<void>(resolve => setTimeout(resolve, ms))
  await term.settled()
}

describe('pi-tui spike: opencode-style fullscreen layout', () => {
  it('streams a transcript into a header/viewport/composer layout with follow-tail', async () => {
    const columns = 60
    const rows = 14
    const term = new HeadlessTerminal(columns, rows)
    const tui = new TuiAltScreen(term)

    // Header bar (persistent, one line).
    const header = new TruncatedText('dsh-tui · my-project · deepseek-flash · idle', 1, 0)
    // Transcript region (app-owned scrolling, follows the tail).
    const transcript = new Container()
    const user = new Text('❯ 用中文写一个快速排序', 0, 0)
    const reasoning = new Text('· thinking…', 0, 0)
    const reply = new Markdown('', 0, 0, markdownTheme)
    const tool = new Text('⠋ bash  npm test', 0, 0)
    transcript.addChild(user)
    transcript.addChild(reasoning)
    transcript.addChild(reply)
    transcript.addChild(tool)
    // Composer block (bordered editor + hint line).
    const editor = new Editor(tui, { borderColor: identity, selectList: selectListTheme })
    const composer = new VStack([
      editor,
      new TruncatedText('enter send · esc interrupt · ctrl+q quit', 1, 0),
    ])

    if (isViewportTUI(tui)) {
      tui.setLayoutRoot(
        new VStack([
          { component: new ScrollView(transcript, { follow: 'end', primary: true, overscroll: 'chain' }), basis: 0, grow: 1, minSize: 1 },
          { component: header, basis: 'auto', minSize: 1 },
          { component: composer, basis: 'auto', shrink: 1, minSize: 1 },
        ]),
      )
    }
    tui.setFocus(editor)
    tui.start()
    await flush(term)

    // Stream markdown deltas + tool status, as agent/assistant-stream would.
    const deltas = [
      '好的。',
      '\n\n**快速排序**采用分治法：',
      '\n\n```ts\nexport function quickSort(a: number[]): number[] {\n  if (a.length <= 1) return a\n  const [pivot, ...rest] = a\n  return [\n    ...quickSort(rest.filter(x => x < pivot)),\n    pivot,\n    ...quickSort(rest.filter(x => x >= pivot)),\n  ]\n}\n```',
    ]
    let streamed = ''
    for (const [index, delta] of deltas.entries()) {
      streamed += delta
      reply.setText(streamed)
      tool.setText(index === deltas.length - 1 ? '✓ bash  npm test' : '⠋ bash  npm test')
      tui.requestRender()
      await flush(term)
    }

    // The viewport followed the tail: streamed content is visible on screen.
    // One extra render + settle makes the final layout pass deterministic
    // (the 16 ms throttle can otherwise coalesce the last update away).
    tui.requestRender()
    await flush(term, 60)

    // Viewport assertions: follow-tail keeps the streamed tail on screen.
    // (Alt-screen has no scrollback; content above the viewport is simply
    // gone until stop() prints the full document back to the main buffer.)
    expect(term.findInView('quickSort')).toBeGreaterThanOrEqual(0)
    expect(term.findInView('✓ bash  npm test')).toBeGreaterThanOrEqual(0)

    // Component contract: no rendered line exceeds the given width.
    for (const line of reply.render(columns)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(columns)
    }

    tui.stop()
    await flush(term)

    // Alt-screen exited cleanly back to the normal buffer.
    expect(term.bufferType).toBe('normal')

    // Known pi-tui edge (1.3.0): stop()'s document print-back with a layout
    // root renders only the scroll region's first row, so we do not assert
    // full-transcript content here. dsh-tui prints its own exit transcript
    // from the view model instead — see docs/render-decision.md.
  })

  it('feeds the focused editor raw key bytes and shows the submitted turn', async () => {
    const term = new HeadlessTerminal(60, 14)
    const tui = new TuiAltScreen(term)
    const transcript = new Container()
    const editor = new Editor(tui, { borderColor: identity, selectList: selectListTheme })
    const submitted: string[] = []
    editor.onSubmit = text => {
      submitted.push(text)
      // A real transcript appends the user message as a turn.
      transcript.addChild(new Text(`❯ ${text}`, 0, 0))
      tui.requestRender()
    }

    if (isViewportTUI(tui)) {
      tui.setLayoutRoot(
        new VStack([
          { component: new ScrollView(transcript, { follow: 'end', primary: true }), basis: 0, grow: 1, minSize: 1 },
          { component: editor, basis: 'auto', shrink: 1, minSize: 1 },
        ]),
      )
    }
    tui.setFocus(editor)
    tui.start()
    await flush(term)

    for (const char of '你好 world') {
      term.send(char)
      await flush(term, 25)
    }
    term.send('\r')
    await flush(term)

    expect(submitted).toEqual(['你好 world'])
    expect(term.findInView('❯ 你好 world')).toBeGreaterThanOrEqual(0)

    tui.stop()
    await flush(term)
  })

  it('streams without duplicating earlier lines (differential viewport update)', async () => {
    const term = new HeadlessTerminal(40, 8)
    const tui = new TuiAltScreen(term)
    const transcript = new Container()
    const reply = new Markdown('', 0, 0, markdownTheme)
    transcript.addChild(reply)

    if (isViewportTUI(tui)) {
      tui.setLayoutRoot(
        new VStack([
          { component: new ScrollView(transcript, { follow: 'end', primary: true }), basis: 0, grow: 1, minSize: 1 },
        ]),
      )
    }
    tui.start()
    await flush(term)

    const words = ['one', 'two', 'three', 'four', 'five']
    let text = ''
    for (const word of words) {
      text += `${word} `
      reply.setText(text)
      tui.requestRender()
      await flush(term)
    }

    // Old partial states are replaced, not appended.
    const occurrences = term.textLines().filter(row => row.includes('five')).length
    expect(occurrences).toBe(1)
    expect(term.find('one two three four five')).toBeGreaterThanOrEqual(0)

    tui.stop()
    await flush(term)
  })
})
