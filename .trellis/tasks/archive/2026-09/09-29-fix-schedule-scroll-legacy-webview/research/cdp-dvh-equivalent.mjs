/**
 * 「不支持 dvh 的引擎」等价条件探针（AC-2 / AC-3 的验收器械）。
 *
 * 做法：把页面里所有 `height: 100dvh` 声明从 CSSOM 里删掉 —— 这正是旧引擎忽略该声明的结果
 * （不删整条规则，所以同一规则里的 `overflow:hidden` 等仍然生效，与真实行为一致）。
 *
 * 预期：
 * - 修复前（`html,body` 的高度只有 dvh 一条来源）：`html/body` 高度退化到内容高度、
 *   `[data-schedule-scroll]` 的 `maxScrollTop` 为 0、纵向拖动后 `scrollTop` 不动。
 * - 修复后（存在 `height:100%` 兜底）：容器恢复为「视口分配高度」，`maxScrollTop > 0`，
 *   纵向拖动能把 `scrollTop` 推到 `maxScrollTop`，且 `body` 高度不再超出视口。
 *
 * 用法：node cdp-dvh-equivalent.mjs <cdp-ws-url>
 */
const STEP_MS = 16
const SETTLE_MS = 420

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
  const rows = [...document.querySelectorAll('[data-section-row]')]
  const lastRow = rows[rows.length - 1] ?? null
  return {
    innerH: window.innerHeight,
    htmlHeight: getComputedStyle(document.documentElement).height,
    bodyHeight: getComputedStyle(document.body).height,
    bodyDocHeight: document.body.scrollHeight,
    clientH: el.clientHeight,
    scrollH: el.scrollHeight,
    maxScrollTop: el.scrollHeight - el.clientHeight,
    scrollTop: el.scrollTop,
    scrollTopBeforeDrag: el.scrollTop,
    lastRowTop: lastRow ? Math.round(lastRow.getBoundingClientRect().top) : null,
    lastRowBottom: lastRow ? Math.round(lastRow.getBoundingClientRect().bottom) : null,
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

/**
 * 删除所有 `height: 100dvh` 声明（含 `@supports` / `@layer` / `@media` 嵌套里的）。
 *
 * @returns 被删掉的声明数：0 说明产物里本来就没有 dvh 声明（或内核不认识它）。
 */
const SIMULATE = `(() => {
  const removed = []
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule.style && rule.style.getPropertyValue('height') === '100dvh') {
        rule.style.removeProperty('height')
        removed.push(rule.selectorText ?? '(anonymous)')
      }
      if (rule.cssRules) visit(rule.cssRules)
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules)
    } catch {
      // 跨域样式表读不到，本项目全是同源内联样式表，忽略
    }
  }
  return removed
})()`

const report = {}
report.before = await probe()
await verticalDrag(650, 350)
report.beforeAfterDrag = await probe()
await evaluate(`(() => { const el = document.querySelector('[data-schedule-scroll]'); el.scrollTop = 0; return null })()`)

report.removedDeclarations = await evaluate(SIMULATE)
await sleep(400)

report.simulated = await probe()
await verticalDrag(650, 350)
report.simulatedAfterDrag = await probe()
const shot = await send('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync(process.argv[3] ?? '/tmp/ct-dvh-equivalent.png', Buffer.from(shot.data, 'base64'))

console.log(JSON.stringify(report, null, 2))
socket.close()
