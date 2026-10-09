/**
 * 复现「旧 WebView 不支持 dvh」时的布局后果。
 *
 * 构建产物里 html,body 只剩 `height:100dvh`（`height:100%` 兜底被 lightningcss 删了），
 * 所以在不支持 dvh 的引擎上 html/body 就是 `height: auto` —— 本脚本用 `height:auto !important`
 * 精确模拟这一情形，然后测课表滚动容器的 clientHeight / scrollHeight 与纵向拖动是否还能滚。
 *
 * 用法：node ct-dvh-sim.mjs <cdp-ws-url>
 */
const STEP_MS = 16
const SETTLE_MS = 400

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
  const grid = document.querySelector('[data-schedule-grid]')
  const cs = getComputedStyle(document.documentElement)
  const bodyCs = getComputedStyle(document.body)
  const stage = document.querySelector('[data-schedule-swipe-stage]')
  const inset = stage ? stage.parentElement.parentElement : null
  return {
    innerH: window.innerHeight,
    htmlHeight: cs.height,
    htmlOverflow: cs.overflow,
    bodyHeight: bodyCs.height,
    bodyOverflow: bodyCs.overflow,
    bodyScrollHeight: document.body.scrollHeight,
    appViewportHeight: inset && inset.parentElement ? getComputedStyle(inset.parentElement).height : null,
    scroll: {
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      scrollTop: el.scrollTop,
      maxScrollTop: el.scrollHeight - el.clientHeight,
      rectTop: Math.round(el.getBoundingClientRect().top),
      rectBottom: Math.round(el.getBoundingClientRect().bottom),
      overflowY: getComputedStyle(el).overflowY,
    },
    stage: stage ? { clientH: stage.clientHeight, rectBottom: Math.round(stage.getBoundingClientRect().bottom) } : null,
    grid: { clientH: grid.clientHeight, scrollH: grid.scrollHeight, rectH: Math.round(grid.getBoundingClientRect().height) },
    lastRowBottom: (() => {
      const rows = [...document.querySelectorAll('[data-section-row]')]
      const last = rows[rows.length - 1]
      const lastCell = [...document.querySelectorAll('[data-course-wrapper]')].pop()
      const probe = lastCell ? lastCell.getBoundingClientRect() : last ? last.getBoundingClientRect() : null
      return probe ? { top: Math.round(probe.top), bottom: Math.round(probe.bottom) } : null
    })(),
  }
})()`

const probe = () => evaluate(PROBE)
const point = (x, y) => ({ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 })

async function verticalDrag(fromY, toY, x = 200, steps = 14) {
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

const report = {}

report.baseline = await probe()
await verticalDrag(650, 350)
report.baselineAfterDrag = await probe()
await evaluate(`(() => { const el = document.querySelector('[data-schedule-scroll]'); el.scrollTop = 0; return null })()`)

// 模拟旧 WebView：dvh 不支持 → html/body 没有 height 声明 → auto
await evaluate(`(() => {
  const style = document.createElement('style')
  style.id = 'simulate-old-webview'
  style.textContent = 'html, body { height: auto !important; }'
  document.head.appendChild(style)
  return null
})()`)
await sleep(500)

report.simulated = await probe()
await verticalDrag(650, 350)
report.simulatedAfterDrag = await probe()
const shot = await send('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync('/tmp/ct-dvh-sim.png', Buffer.from(shot.data, 'base64'))

await evaluate(`(() => { document.getElementById('simulate-old-webview')?.remove(); return null })()`)

console.log(JSON.stringify(report, null, 2))
socket.close()
