// 单指纵向滚动与课程卡真实触摸点按回归。用法：node verify-zoom-input.mjs <page-ws> [out.json]
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [url, output] = process.argv.slice(2)
if (!url) throw new Error('需要 page target 的 CDP WebSocket URL')
const socket = new WebSocket(url)
const pending = new Map()
let id = 0
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(JSON.stringify(message.error)))
  else request.resolve(message.result)
})
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const point = (x, y) => ({ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 })
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true })

const scrollGeometry = await evaluate(`(() => {
  const el = document.querySelector('[data-schedule-scroll]')
  el.scrollTop = 0
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, startY: r.top + Math.min(r.height - 30, 420), maxScrollTop: el.scrollHeight - el.clientHeight }
})()`)
assert.ok(scrollGeometry.maxScrollTop > 0, '夹具必须可纵向滚动')
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(scrollGeometry.x, scrollGeometry.startY)] })
for (let step = 1; step <= 8; step += 1) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(scrollGeometry.x, scrollGeometry.startY - step * 30)] })
  await sleep(20)
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(250)
const scrollTop = await evaluate("document.querySelector('[data-schedule-scroll]').scrollTop")
assert.ok(scrollTop > 0, `单指纵向滚动后 scrollTop=${scrollTop}`)

await evaluate("document.querySelector('[data-schedule-scroll]').scrollTop = 0")
await sleep(100)
const cellCenter = await evaluate(`(() => {
  const cell = document.querySelector('[data-course-cell]')
  const r = cell.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 30) }
})()`)
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(cellCenter.x, cellCenter.y)] })
await sleep(60)
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(200)
const dialogOpened = await evaluate("Boolean(document.querySelector('[role=dialog]'))")
assert.equal(dialogOpened, true, '真实触摸点按课程卡应打开课程对话框')
const rest = await evaluate(`(() => {
  const grid = document.querySelector('[data-schedule-grid]')
  const stage = document.querySelector('[data-schedule-zoom-stage]')
  return { transform: grid.style.transform, filter: grid.style.filter, phase: stage.dataset.scheduleZoomPreview ?? null }
})()`)
assert.deepEqual(rest, { transform: '', filter: '', phase: null }, '输入回归后不得残留缩放预览')
const report = { maxScrollTop: scrollGeometry.maxScrollTop, scrollTop, dialogOpened, rest }
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
socket.close()
