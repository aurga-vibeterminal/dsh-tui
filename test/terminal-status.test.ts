import { describe, expect, it } from 'vitest'
import { aggregateStatus, type DriverStatus } from '../src/agent-driver.ts'
import { terminalProgressActive, TuiApp } from '../src/app.ts'

const running = { running: true, maintenance: false, attempts: 0, subagents: 0 }

function status(blocked: 'permission' | 'question' | undefined): DriverStatus {
  return aggregateStatus({ ...running, blocked })
}

describe('terminal progress', () => {
  it('is active only for work that is not waiting on the user', () => {
    expect(terminalProgressActive(status(undefined))).toBe(true)
    expect(terminalProgressActive(status('permission'))).toBe(false)
    expect(terminalProgressActive(status('question'))).toBe(false)

    const idle = aggregateStatus({
      running: false,
      maintenance: false,
      attempts: 0,
      subagents: 0,
      blocked: undefined,
    })
    expect(terminalProgressActive(idle)).toBe(false)
  })

  it('clears actual terminal progress for a block and resumes it afterward', () => {
    const progress: boolean[] = []
    const app = {
      tui: {
        terminal: {
          setProgress: (active: boolean) => { progress.push(active) },
          setProgramStatus: () => {},
        },
      },
      driver: { model: { title: 'Status test' } },
      log: { debug: () => {} },
      lastProgressActive: undefined,
      lastProgramStatus: '',
    } as unknown as TuiApp
    const reporter = TuiApp.prototype as unknown as {
      reportTerminalStatus(status: DriverStatus): void
    }

    reporter.reportTerminalStatus.call(app, status(undefined))
    reporter.reportTerminalStatus.call(app, status('permission'))
    reporter.reportTerminalStatus.call(app, status('question'))
    reporter.reportTerminalStatus.call(app, status(undefined))

    expect(progress).toEqual([true, false, true])
  })
})
