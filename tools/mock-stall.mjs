/** Standalone stall server for manual debugging (see tools/record.mjs). */
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const server = await startMockLlmServer({
  port: 0,
  apiKey: 'mock-key',
  sequence: ['stall', 'success', 'success'],
  successText: 'ok',
})
console.log(`${server.baseURL}/v1`)
console.log(`port=${String(server.port)}`)
process.on('SIGINT', () => { void server.close().then(() => process.exit(0)) })
setInterval(() => {}, 60000)
