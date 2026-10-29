import { describe, expect, it } from 'vitest'

import { CompactQueue, PressureLatch } from '../src/compact-queue.ts'

interface DelegateLog {
  queued: number
  duplicates: number
  errors: string[]
  dispatches: number
}

function makeDelegate(overrides?: Partial<{
  isRunning: () => boolean
  whenIdle: () => Promise<void>
}>): { delegate: Parameters<CompactQueue['request']>[0], log: DelegateLog } {
  const log: DelegateLog = { queued: 0, duplicates: 0, errors: [], dispatches: 0 }
  return {
    log,
    delegate: {
      isRunning: overrides?.isRunning ?? (() => false),
      whenIdle: overrides?.whenIdle ?? (async () => {}),
      dispatch: async () => {
        log.dispatches += 1
      },
      onQueued: () => {
        log.queued += 1
      },
      onDuplicate: () => {
        log.duplicates += 1
      },
      onError: message => {
        log.errors.push(message)
      },
    },
  }
}

/** Drain pending microtasks (the queue chains promises internally). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('CompactQueue', () => {
  it('queues a request made during a running turn and dispatches once idle', async () => {
    let running = true
    let resolveIdle!: () => void
    const idle = new Promise<void>(resolve => { resolveIdle = resolve })
    const { delegate, log } = makeDelegate({
      isRunning: () => running,
      whenIdle: () => idle,
    })
    const queue = new CompactQueue()
    queue.request(delegate)
    expect(log.queued).toBe(1)
    expect(log.dispatches).toBe(0)

    running = false
    resolveIdle()
    await settle()
    expect(log.dispatches).toBe(1)
  })

  it('coalesces repeat requests into one dispatch', async () => {
    let resolveIdle!: () => void
    const idle = new Promise<void>(resolve => { resolveIdle = resolve })
    const { delegate, log } = makeDelegate({ whenIdle: () => idle })
    const queue = new CompactQueue()
    queue.request(delegate)
    queue.request(delegate)
    queue.request(delegate)
    expect(log.queued).toBe(1)
    expect(log.duplicates).toBe(2)

    resolveIdle()
    await settle()
    expect(log.dispatches).toBe(1)
  })

  it('re-waits when a new turn races in between idle and dispatch', async () => {
    let running = true
    const idleResolvers: Array<() => void> = []
    const whenIdle = async (): Promise<void> => {
      await new Promise<void>(resolve => { idleResolvers.push(resolve) })
    }
    const { delegate, log } = makeDelegate({ isRunning: () => running, whenIdle })
    const queue = new CompactQueue()
    queue.request(delegate)

    // First idle resolution: a new turn already woke the agent again.
    running = true
    idleResolvers.shift()!()
    await settle()
    expect(log.dispatches).toBe(0)

    // Second idle resolution: genuinely idle now.
    running = false
    idleResolvers.shift()!()
    await settle()
    expect(log.dispatches).toBe(1)
  })

  it('surfaces failures and clears the latch for a retry', async () => {
    let fail = true
    const log: DelegateLog = { queued: 0, duplicates: 0, errors: [], dispatches: 0 }
    const delegate = {
      isRunning: () => false,
      whenIdle: async () => {},
      dispatch: async (): Promise<void> => {
        if (fail) throw new Error('boom')
        log.dispatches += 1
      },
      onQueued: () => { log.queued += 1 },
      onDuplicate: () => { log.duplicates += 1 },
      onError: (message: string) => { log.errors.push(message) },
    }
    const queue = new CompactQueue()
    queue.request(delegate)
    await settle()
    expect(log.errors).toEqual(['boom'])
    expect(log.dispatches).toBe(0)

    fail = false
    queue.request(delegate)
    await settle()
    expect(log.dispatches).toBe(1)
  })
})

describe('PressureLatch', () => {
  it('fires once per band crossing and re-arms below the rearm point', () => {
    const latch = new PressureLatch(0.7, 0.6)
    expect(latch.shouldNotify(0.5)).toBe(false)
    expect(latch.shouldNotify(0.71)).toBe(true)
    expect(latch.shouldNotify(0.9)).toBe(false)
    // Still above rearm: stays latched.
    expect(latch.shouldNotify(0.65)).toBe(false)
    // Dropped below rearm (e.g. after a compaction): re-armed.
    expect(latch.shouldNotify(0.5)).toBe(false)
    expect(latch.shouldNotify(0.72)).toBe(true)
  })

  it('does not fire exactly at the rearm boundary or below notify threshold', () => {
    const latch = new PressureLatch(0.7, 0.6)
    expect(latch.shouldNotify(0.6)).toBe(false)
    expect(latch.shouldNotify(0.69)).toBe(false)
  })
})
