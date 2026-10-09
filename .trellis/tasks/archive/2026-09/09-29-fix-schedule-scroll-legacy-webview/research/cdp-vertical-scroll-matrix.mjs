/**
 * 多视口纵向滚动探针：在每个视口高度下做一次纯纵向拖动，读 scrollTop 变化。
 * 用法：node ct-vscroll-matrix.mjs <cdp-ws-url>
 */
const SETTLE_MS = 350
const STEP_MS = 16

const wsUrl = process.argv[2]
const resolvePageTarget = async (url) => {
  const match = /^ws:\/\/([^/]+)\//.exec(url)
  if (!match) return url
  try {
    const response = await fetch(`http://${match[1]}/json/list`)
    const targets = await response.json()
    const page = targets.find((target) => target.type === 'page' && !target.url.startsWith('devtools://'))
    if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
  } catch (error) {
    console.error(`page target lookup failed: ${error.message}`)
  }
  return url
}

const socket = new WebSocket(await resolvePageTarget(wsUrl))
let nextId = 1
const pending = new Map()

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) reject(new Error(JSON.stringify(message.error)))
  else resolve(message.result)
})

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId
    nextId += 1
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`)
  return result.result.value
}

const PROBE = `(() => {
  const el = document.querySelector('[data-schedule-scroll]')
  if (!el) return { missing: true, innerH: window.innerHeight }
  return {
    innerH: window.innerHeight,
    clientH: el.clientHeight,
    scrollH: el.scrollHeight,
    maxScrollTop: el.scrollHeight - el.clientHeight,
    scrollTop: el.scrollTop,
    rectTop: Math.round(el.getBoundingClientRect().top),
    rectHeight: Math.round(el.getBoundingClientRect().height),
  }
})()`

const probe = () => evaluate(PROBE)
const point = (x, y) => ({ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 })

async function verticalDrag(fromY, toY, x = 200, steps = 12) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(x, fromY)] })
  await sleep(STEP_MS)
  for (let step = 1; step <= steps; step += 1) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(x, fromY + ((toY - fromY) * step) / steps)],
    })
    await sleep(STEP_MS)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(SETTLE_MS)
}

const HEIGHTS = [915, 800, 740, 700, 660, 600, 540]
const WIDTHS = [412, 360]
const report = []

for (const width of WIDTHS) {
  for (const height of HEIGHTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: width,
      screenHeight: height,
    })
    await sleep(400)
    const before = await probe()
    if (before.missing) {
      report.push({ width, height, missing: true })
      continue
    }
    await evaluate(`document.querySelector('[data-schedule-scroll]').scrollTop = 0`)
    await sleep(120)
    const startY = Math.round(before.rectTop + before.rectHeight * 0.75)
    const endY = Math.max(Math.round(before.rectTop + 20), startY - 300)
    await verticalDrag(startY, endY)
    const after = await probe()
    await evaluate(`document.querySelector('[data-schedule-scroll]').scrollTop = 0`)
    report.push({ width, height, before, startY, endY, after })
  }
}

console.log(JSON.stringify(report, null, 2))
socket.close()
