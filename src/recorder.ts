/**
 * dsh-tui fixture recorder — dev tooling behind `--record <dir>`.
 *
 * Drives exactly one real agent turn in-process (the same way the Phase 1
 * interactive loop will) and captures the raw surfaces the TUI renders from,
 * so component/fold tests run against genuine protocol shapes:
 *
 * - `events.jsonl`  — every durable `SessionEvent` of the recorded session
 * - `stream.jsonl`  — every live `agent/assistant-stream` frame
 * - `statuses.jsonl`— every `agent/status` transition (idle/running spinner)
 * - `meta.json`     — session identity, prompt, route, counts
 *
 * Regenerate with `pnpm record <name> "<prompt>"` (tools/record.mjs), which
 * points the DeepSeek adapter at dsh-llm-mock-server, so no API key is needed.
 * See docs/PLAN.md §8 (testing) and §8.4 (contract tests on dependency bumps).
 * @module dsh-tui/recorder
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'

/** Where the recorder writes one fixture scenario. */
export interface RecordOptions {
  /** Output directory; created when absent. */
  outDir: string
  /** The prompt text driving the recorded turn. */
  prompt: string
  /** Interrupt the turn after this many milliseconds (0 = immediately). */
  interruptAfterMs: number | undefined
}

/** One recorded live stream frame, exactly as the event carried it. */
type StreamRecord = { frame: unknown }

/**
 * Run one owned agent turn and write the fixture files.
 * @param ctx - plugin context carrying the core services.
 * @param options - output directory and the driving prompt.
 */
export async function recordFixture(ctx: Context, options: RecordOptions): Promise<void> {
  process.stderr.write(`record: fixture run (interruptAfterMs=${String(options.interruptAfterMs)})\n`)
  // Sibling rows must settle before an Agent is created.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error('tui-recorder: core services (agents, agentDefaultModel, sessions) are unavailable')
  }

  const selection = defaultModel.currentSelection()
  const agentOptions = { provider: selection.provider, model: selection.model }
  const setup = (agentCtx: Context): void => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }
  const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
  const fs = ctx.get('fs')
  const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
  const { agent } = await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
  await agent.whenIdle()

  // Subscribe before the prompt so the fixture carries the complete turn.
  const events: SessionEvent[] = []
  const stream: StreamRecord[] = []
  const statuses: string[] = []
  const stopEvents = ctx.on('session/event', (session, event) => {
    if (session === agent.session) events.push(event)
  })
  const stopStream = ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
    if (subject === agent) stream.push({ frame })
  })
  const stopStatuses = ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject === agent) statuses.push(status)
  })

  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: options.prompt }],
      source: { kind: 'user' },
    }))
    process.stderr.write('record: prompt sent\n')
    const stopProgress = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent) process.stderr.write(`record: status=${status}\n`)
    })
    if (options.interruptAfterMs !== undefined) {
      const timer = setTimeout(() => {
        try {
          agent.cancel({ kind: 'user' }, { keepInbox: true })
          process.stderr.write('record: cancel requested\n')
        } catch (error: unknown) {
          process.stderr.write(`record: cancel threw: ${error instanceof Error ? error.message : String(error)}\n`)
        }
      }, options.interruptAfterMs)
      timer.unref()
    }
    const subagents = ctx.get('subagents')
    while (true) {
      await agent.whenIdle()
      const idleSeq = agent.session.seq
      // Child settlement can wake the parent before the child wait observes it.
      if (!await subagents?.waitForChildren(agent)
        && agent.status === 'idle' && agent.session.seq === idleSeq) break
    }
    process.stderr.write('record: idle reached\n')
    stopProgress()
  } finally {
    stopEvents()
    stopStream()
    stopStatuses()
  }
  await sessions.flush(agent.session)

  await mkdir(options.outDir, { recursive: true })
  const write = async (name: string, rows: unknown[]): Promise<void> => {
    const body = rows.map(row => JSON.stringify(row)).join('\n')
    await writeFile(join(options.outDir, name), `${body}\n`, 'utf8')
  }
  await write('events.jsonl', events)
  await write('stream.jsonl', stream)
  await write('statuses.jsonl', statuses)
  await writeFile(
    join(options.outDir, 'meta.json'),
    `${JSON.stringify({
      sessionId,
      prompt: options.prompt,
      cwd,
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      recordedAt: new Date().toISOString(),
      eventCount: events.length,
      frameCount: stream.length,
      statusCount: statuses.length,
    }, null, 2)}\n`,
    'utf8',
  )
}
