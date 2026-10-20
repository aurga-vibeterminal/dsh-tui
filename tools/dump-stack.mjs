/** Attach to a --inspect process, pause it, and dump the current JS stack. */
const port = process.argv[2] ?? '9229'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find(entry => entry.webSocketDebuggerUrl !== undefined)
if (target === undefined) throw new Error('no debuggable target')
const ws = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
    return
  }
  if (message.method === 'Debugger.paused') {
    console.log('=== PAUSED — current stack ===')
    for (const frame of message.params.callFrames) {
      const name = frame.functionName === '' ? '(anonymous)' : frame.functionName
      const line = String(frame.location.lineNumber + 1)
      const column = String(frame.location.columnNumber + 1)
      console.log(name + ' @ ' + frame.url + ':' + line + ':' + column)
    }
    process.exit(0)
  }
}
await new Promise((resolve) => { ws.onopen = resolve })
await send('Debugger.enable')
await send('Runtime.enable')
await send('Debugger.pause')
setTimeout(() => {
  console.log('no pause event within 10s — loop may be idle, not blocked')
  process.exit(1)
}, 10000)
