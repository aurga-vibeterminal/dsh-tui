/**
 * `agent/status` alone under-reports work: a settled parent can hold live
 * background subagents, and maintenance tasks (compaction) run with public
 * status `idle` while an LLM request is in flight. The aggregate is what the
 * header spinner and the terminal status reports follow.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { aggregateStatus, createDriver } from '../src/agent-driver.ts'
import type { TranscriptModel } from '../src/events.ts'

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

describe('driver settle', () => {
  /** Fake agent with a live `status` mirror, a controllable whenIdle, and
   * capturable subagent listeners on its scoped context. `whenIdle()` resolves
   * immediately until `armActivity()` swaps in a pending promise (createDriver
   * itself awaits whenIdle, so it must start resolved). */
  function makeFakeAgent(): {
    raw: { status: 'idle' | 'running' }
    agent: Agent
    armActivity: () => Promise<void>
    resolveActivity: () => void
    emitSubagent: (event: 'subagent/start' | 'subagent/end', info: unknown) => void
  } {
    let settle: (() => void) | undefined
    let current: Promise<void> = Promise.resolve()
    const subagentListeners = new Map<string, (info: never) => void>()
    const raw = {
      id: 'session-test',
      status: 'idle' as 'idle' | 'running',
      session: { seq: 0, eventAt: () => undefined },
      ctx: {
        on(event: string, listener: (info: never) => void): () => void {
          if (event === 'subagent/start' || event === 'subagent/end') subagentListeners.set(event, listener)
          return () => {}
        },
      },
      whenIdle: () => current,
      // Cancel aborts the turn and converges the mirror to idle.
      cancel: () => { raw.status = 'idle'; settle?.() },
    }
    return {
      raw,
      agent: raw as unknown as Agent,
      armActivity: () => {
        const pending = new Promise<void>(resolve => { settle = resolve })
        current = pending
        return pending
      },
      resolveActivity: () => { settle?.() },
      emitSubagent: (event, info) => subagentListeners.get(event)?.(info as never),
    }
  }

  /** Fake context capturing agent/status and agent/disposed listeners. */
  function makeFakeCtx(agent: Agent): {
    ctx: Context
    emitStatus: (status: 'running' | 'idle') => void
    emitDisposed: (id: string) => void
  } {
    let emitStatus: ((status: 'running' | 'idle') => void) | undefined
    let emitDisposed: ((id: string) => void) | undefined
    const ctx = {
      get(name: string): unknown {
        if (name === 'agents') return { resume: async () => ({ agent, dispose: async () => {} }) }
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test' }) }
        if (name === 'sessions') return { flush: async () => {} }
        if (name === 'sessionPersistence') return {}
        return undefined
      },
      on(event: string, listener: unknown): () => void {
        if (event === 'agent/status') {
          emitStatus = status => (listener as (event: { agent: Agent, status: string }) => void)({ agent, status })
        }
        if (event === 'agent/disposed') {
          emitDisposed = id => (listener as (event: { agent: { id: string } }) => void)({ agent: { id } })
        }
        return () => {}
      },
    } as unknown as Context
    return { ctx, emitStatus: status => emitStatus?.(status), emitDisposed: id => emitDisposed?.(id) }
  }

  async function makeDriver(agent: Agent, ctx: Context) {
    const driver = await createDriver(ctx, {} as TranscriptModel, { resume: 'session-test', model: undefined, preset: undefined })
    return driver
  }

  it('clears running after cancellation even when the final idle event is missing', async () => {
    const fake = makeFakeAgent()
    const { ctx, emitStatus } = makeFakeCtx(fake.agent)
    const driver = await makeDriver(fake.agent, ctx)

    const activity = fake.armActivity()
    fake.raw.status = 'running'
    emitStatus('running')
    expect(driver.busy).toBe(true)
    driver.cancel()
    await activity

    expect(driver.running).toBe(false)
    expect(driver.busy).toBe(false)
    await driver.dispose()
  })

  it('keeps running when a new turn races in before the settle handler runs', async () => {
    const fake = makeFakeAgent()
    const { ctx, emitStatus } = makeFakeCtx(fake.agent)
    const driver = await makeDriver(fake.agent, ctx)

    const activity = fake.armActivity()
    fake.raw.status = 'running'
    emitStatus('running')
    // The settle observation resolves, but a new wake re-enters running
    // synchronously before the reap microtask gets to run.
    fake.resolveActivity()
    emitStatus('running')
    await activity

    expect(driver.running).toBe(true)
    expect(driver.busy).toBe(true)

    // The genuinely restarted turn still settles normally.
    fake.raw.status = 'idle'
    emitStatus('idle')
    expect(driver.running).toBe(false)
    await driver.dispose()
  })

  it('reconciles stale flags on the low-frequency tick when every event is missed', async () => {
    vi.useFakeTimers()
    try {
      const fake = makeFakeAgent()
      const { ctx, emitStatus } = makeFakeCtx(fake.agent)
      const driver = await makeDriver(fake.agent, ctx)

      fake.armActivity()
      fake.raw.status = 'running'
      emitStatus('running')
      expect(driver.busy).toBe(true)

      // The agent's own mirror says idle, but no event and no settle
      // observation ever arrives: the tick is the last line of defense.
      fake.raw.status = 'idle'
      vi.advanceTimersByTime(5_000)

      expect(driver.running).toBe(false)
      expect(driver.busy).toBe(false)
      await driver.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops orphaned subagent runs when the child agent is disposed', async () => {
    const fake = makeFakeAgent()
    const { ctx, emitDisposed } = makeFakeCtx(fake.agent)
    const driver = await makeDriver(fake.agent, ctx)

    fake.emitSubagent('subagent/start', { runId: 'run-1', id: 'child-1', provider: 'p', local: true })
    expect(driver.busy).toBe(true)
    expect(driver.status.subagents).toBe(1)

    // The paired subagent/end never arrives; the child's disposal is the
    // authoritative cleanup.
    emitDisposed('child-1')
    expect(driver.busy).toBe(false)
    expect(driver.status.subagents).toBe(0)
    await driver.dispose()
  })
})
