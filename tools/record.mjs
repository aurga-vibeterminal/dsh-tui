/**
 * Fixture recording driver (dev tooling; not shipped in lib/).
 *
 * Starts dsh-llm-mock-server on an OS-assigned port, points the DeepSeek
 * adapter at it through DEEPSEEK_BASE_URL/DEEPSEEK_API_KEY, and runs one
 * `dsh --profile tui --record <dir> "<prompt>"` turn against it — no API key
 * needed. The recording itself lives in src/recorder.ts (in-process plugin).
 *
 * Usage:
 *   node tools/record.mjs <fixture-name> "<prompt>"
 *   node tools/record.mjs <fixture-name> "<prompt>" --tool-call
 *
 * Fixtures land in test/fixtures/<fixture-name>/ (committed; regenerate on
 * dsh version bumps — docs/PLAN.md §8.4).
 */
import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const toolCall = args.includes('--tool-call')
const interrupt = args.includes('--interrupt')
const positional = args.filter(argument => argument !== '--tool-call' && argument !== '--interrupt')
const [name, ...promptParts] = positional
const prompt = promptParts.join(' ')
if (name === undefined || name.trim() === '' || prompt.trim() === '') {
  console.error('usage: node tools/record.mjs <fixture-name> "<prompt>" [--tool-call]')
  process.exit(2)
}

const outDir = join(repoRoot, 'test', 'fixtures', name)
const reasoningText = '用户要快速排序的中文解释。我先想清楚结构：先给一段简短的算法说明，再给 TypeScript 实现，最后补一句复杂度。'
const successText = [
  '**快速排序**采用分治法：选一个基准元素，把数组分成小于和大于基准的两部分，再递归排序。',
  '',
  '```ts',
  'export function quickSort(a: number[]): number[] {',
  '  if (a.length <= 1) return a',
  '  const [pivot, ...rest] = a',
  '  return [',
  '    ...quickSort(rest.filter(x => x < pivot)),',
  '    pivot,',
  '    ...quickSort(rest.filter(x => x >= pivot)),',
  '  ]',
  '}',
  '```',
  '',
  '平均时间复杂度 O(n log n)，最坏 O(n²)；实现简单，常用于内省排序的基础。',
].join('\n')

// Interrupt scenario: the model call stalls, the turn is cancelled
// mid-flight after a delay — the exact surface Ctrl+C exercises.
const sequence = interrupt ? ['stall', 'success', 'success'] : toolCall
  ? ['tool_call_success', 'success', 'success']
  : ['reasoning_success', 'success']

const server = await startMockLlmServer({
  port: 0,
  apiKey: 'mock-key',
  sequence,
  reasoningText,
  successText,
  chunkSize: 48,
  ...(toolCall ? { toolName: 'glob', toolArguments: '{"pattern":"*.md"}' } : {}),
})

console.log(`mock llm: ${server.baseURL}/v1 (sequence: ${sequence.join(', ')})`)

// Fresh output directory; recording runs against the isolated test home.
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

// Async spawn: the mock server runs in this process, so the event loop must
// stay alive to serve the harness's LLM requests while dsh runs.
const run = interrupt
  ? spawn('dsh', ['--profile', 'tui', '--record', outDir, '--interrupt-after', '1200', prompt], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      DSH_HOME: join(repoRoot, '.dsh-test'),
      DEEPSEEK_BASE_URL: `${server.baseURL}/v1`,
      DEEPSEEK_API_KEY: 'mock-key',
    },
  })
  : spawn('dsh', ['--profile', 'tui', '--record', outDir, prompt], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      DSH_HOME: join(repoRoot, '.dsh-test'),
      DEEPSEEK_BASE_URL: `${server.baseURL}/v1`,
      DEEPSEEK_API_KEY: 'mock-key',
    },
  })
const exitCode = await new Promise((resolvePromise, rejectPromise) => {
  run.on('error', rejectPromise)
  run.on('exit', (code) => { resolvePromise(code) })
})

await server.close()

if (exitCode !== 0) {
  console.error(`record run failed with exit code ${String(exitCode)}`)
  process.exit(exitCode ?? 1)
}

console.log(`mock llm saw ${String(server.requests.length)} request(s): ${server.requests.map(request => request.behavior).join(', ')}`)
console.log(`fixture written: ${outDir}`)
