/**
 * `agent/status` alone under-reports work: a settled parent can hold live
 * background subagents, and maintenance tasks (compaction) run with public
 * status `idle` while an LLM request is in flight. The aggregate is what the
 * header spinner and the terminal status reports follow.
 */
import { describe, expect, it } from 'vitest'
import { aggregateStatus } from '../src/agent-driver.ts'

const clear = { running: false, maintenance: false, attempts: 0, subagents: 0, blocked: undefined } as const

describe('aggregateStatus', () => {
  it('reports idle only when every busy source is empty', () => {
    expect(aggregateStatus(clear)).toEqual({
      running: false,
      busy: false,
      blocked: undefined,
      maintenance: false,
      attempts: 0,
      subagents: 0,
    })
  })

  it('keeps busy true while a settled parent has live subagents', () => {
    // The delegation tool returns immediately, so the parent flips to idle
    // first and the children outlive the turn.
    expect(aggregateStatus({ ...clear, running: false, subagents: 2 })).toEqual({
      running: false,
      busy: true,
      blocked: undefined,
      maintenance: false,
      attempts: 0,
      subagents: 2,
    })
  })

  it('treats maintenance work and open requests as busy without claiming a turn', () => {
    for (const flags of [{ ...clear, maintenance: true }, { ...clear, attempts: 1 }]) {
      const status = aggregateStatus(flags)
      expect(status.running).toBe(false)
      expect(status.busy).toBe(true)
    }
  })

  it('carries the counts behind busy so a client can ask why', () => {
    const status = aggregateStatus({ ...clear, attempts: 1, subagents: 3, maintenance: true })
    expect(status).toMatchObject({ attempts: 1, subagents: 3, maintenance: true, busy: true })
  })

  it('passes a block through so the terminal can tell waiting from working', () => {
    expect(aggregateStatus({ ...clear, running: true, blocked: 'permission' }).blocked).toBe('permission')
    expect(aggregateStatus({ ...clear, blocked: 'question' }).blocked).toBe('question')
    // A dialog alone (no work in flight) stays idle: the parent really is done.
    expect(aggregateStatus({ ...clear, blocked: 'question' }).busy).toBe(false)
  })

  it('reports the turn flag independent of the aggregate', () => {
    expect(aggregateStatus({ ...clear, running: true })).toMatchObject({ running: true, busy: true })
  })
})
