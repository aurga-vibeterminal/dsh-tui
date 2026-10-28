import { describe, expect, it, vi } from 'vitest'
import { PickerDialog, QuestionDialog } from '../src/dialogs.ts'
import { darkTheme } from '../src/theme.ts'

const MODES = [
  { value: 'standard', label: 'standard', description: '标准（全套工具）' },
  { value: 'ptc', label: 'ptc', description: 'PTC（程序化工具调用）' },
  { value: 'minimal', label: 'minimal', description: '极简（只读为主）' },
  { value: 'cordis', label: 'cordis', description: '创造（组合编排）' },
]

function makePicker() {
  const requestRender = vi.fn()
  const dialog = new PickerDialog(
    'Agent preset',
    MODES,
    darkTheme,
    requestRender,
    '↑↓ move · enter select · esc cancel',
    8,
  )
  return { dialog, requestRender }
}

describe('PickerDialog', () => {
  it('re-renders its overlay lines when the selection moves (no stale render cache)', () => {
    const { dialog, requestRender } = makePicker()
    const before = dialog.render(80).join('\n')
    dialog.handleInput('\x1b[B') // arrow down
    expect(requestRender).toHaveBeenCalled()
    const after = dialog.render(80).join('\n')
    expect(after).not.toBe(before)
  })

  it('keeps re-rendering across repeated moves', () => {
    const { dialog, requestRender } = makePicker()
    const seen = new Set<string>()
    seen.add(dialog.render(80).join('\n'))
    for (let i = 0; i < 3; i++) {
      dialog.handleInput('\x1b[B')
      seen.add(dialog.render(80).join('\n'))
    }
    expect(seen.size).toBe(4) // every step paints a different frame
    expect(requestRender).toHaveBeenCalledTimes(3)
  })

  it('enter confirms the item the selection moved to', async () => {
    const { dialog } = makePicker()
    dialog.handleInput('\x1b[B') // down → ptc
    dialog.handleInput('\r') // confirm
    await expect(dialog.done).resolves.toBe('ptc')
  })

  it('escape cancels with undefined', async () => {
    const { dialog } = makePicker()
    dialog.handleInput('\x1b')
    await expect(dialog.done).resolves.toBeUndefined()
  })
})

describe('QuestionDialog', () => {
  it('renders option descriptions under their labels', () => {
    const dialog = new QuestionDialog({
      questions: [{
        id: 'model',
        question: 'Switch model',
        options: [
          { label: 'deepseek-account/deepseek-flash (👁)', description: 'DeepSeek V4.1 Flash' },
          { label: 'deepseek-account/deepseek-v4-pro' },
        ],
      }],
    }, darkTheme)
    const lines = dialog.render(80)
    expect(lines.some(line => line.includes('deepseek-flash (👁)'))).toBe(true)
    expect(lines.some(line => line.includes('DeepSeek V4.1 Flash'))).toBe(true)
    // The description follows its own option's label line directly.
    const labelIndex = lines.findIndex(line => line.includes('deepseek-flash (👁)'))
    expect(lines[labelIndex + 1]).toContain('DeepSeek V4.1 Flash')
  })
})
