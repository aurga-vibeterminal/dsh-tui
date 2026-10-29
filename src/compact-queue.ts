/**
 * Manual-compaction queueing and context-pressure latching.
 *
 * `/compact` maps to an idle-only maintenance operation (`compactNow`), so a
 * naive dispatch during a running turn fails with `busy`. The queue defers
 * the request to the next true-idle boundary — turn end — coalescing repeats
 * and surviving turns that race in between. The latch keeps the context
 * pressure hint one-shot per band so it never spams after every turn.
 *
 * @module dsh-tui/compact-queue
 */

/** Host operations the queue drives; supplied by the app. */
export interface CompactQueueDelegate {
  /** Whether the driver currently owns a turn. */
  readonly isRunning: () => boolean
  /** Resolves when the agent next reaches quiescence (no driver, no task). */
  readonly whenIdle: () => Promise<void>
  /** Perform the deferred compaction dispatch (agent is idle when called). */
  readonly dispatch: () => Promise<void> | void
  /** First request while a turn runs. */
  readonly onQueued: () => void
  /** A repeat request while one is already queued. */
  readonly onDuplicate: () => void
  /** The deferred dispatch failed before or during settlement. */
  readonly onError: (message: string) => void
}

/**
 * Defers manual `/compact` requests made while the agent is running.
 *
 * The first request latches (notices "queued"), waits for idle, and — unless
 * a new turn raced in, in which case it waits again — performs the dispatch
 * exactly once. Failures clear the latch and surface through the delegate.
 */
export class CompactQueue {
  private queued = false

  /** Whether a deferred compaction is waiting for the turn to end. */
  get isQueued(): boolean {
    return this.queued
  }

  /** Queue one request; repeats while queued collapse to a notice. */
  request(delegate: CompactQueueDelegate): void {
    if (this.queued) {
      delegate.onDuplicate()
      return
    }
    this.queued = true
    delegate.onQueued()
    void this.awaitIdle(delegate)
  }

  private async awaitIdle(delegate: CompactQueueDelegate): Promise<void> {
    try {
      while (this.queued) {
        await delegate.whenIdle()
        // The latch may have been consumed (or never cleared) between the
        // idle resolution and this check; a wake that raced in means the
        // agent is running again, so wait for that turn too.
        if (!this.queued) return
        if (delegate.isRunning()) continue
        this.queued = false
        await delegate.dispatch()
        return
      }
    } catch (error: unknown) {
      this.queued = false
      delegate.onError(error instanceof Error ? error.message : String(error))
    }
  }
}

/**
 * One-shot-per-band latch for the context-pressure hint: fires when the
 * ratio crosses `notifyAt` from below and re-arms only after it falls back
 * under `rearmBelow` (e.g. after a compaction shrank the history).
 */
export class PressureLatch {
  private notified = false

  constructor(
    private readonly notifyAt: number,
    private readonly rearmBelow: number,
  ) {}

  /** Whether this crossing should surface the hint. */
  shouldNotify(ratio: number): boolean {
    if (this.notified) {
      if (ratio < this.rearmBelow) this.notified = false
      return false
    }
    if (ratio >= this.notifyAt) {
      this.notified = true
      return true
    }
    return false
  }
}
