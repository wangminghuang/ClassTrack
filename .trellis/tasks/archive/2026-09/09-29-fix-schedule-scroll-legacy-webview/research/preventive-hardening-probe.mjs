/**
 * 预防性加固探针：逐个验证候选加固的「基线不变性」与「救援能力」。
 *
 * 三个候选（都是不改行为的加固思路）：
 * - **A** 网格加 `min-height`（= `2.25rem + 12 × 3.875rem` → 构建后折叠成 `48.75rem`）：
 *   把「行溢出」变成「确定子盒超出滚动容器」，让滚动量不依赖内核对子孙溢出的计算。
 * - **C2** 应用外壳自带视口锚点（仅在**不支持 `dvh`** 的引擎上取 `100vh`）：
 *   `html/body` 的单点依赖被打破 —— 即使那层锚点因为任何原因失效，外壳仍有确定高度。
 * - **B**（不在本探针里）手势位移从滚动容器挪到裁剪层，属于另一类加固。
 *
 * 模拟口径与 `cdp-dvh-equivalent.mjs` 一致：把页面里所有 `height: 100dvh` 声明从 CSSOM 删掉
 * = 旧引擎忽略该声明；C2 的效果则按「旧引擎会算出的结果」直接注入 `100vh`（因为 Chrome 支持 `dvh`，
 * `@supports not (height: 100dvh)` 在这里永远不生效，只能注入它解析后的样子）。
 *
 * 用法：node preventive-hardening-probe.mjs <cdp-ws-url>
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
  const scroller = document.querySelector('[data-schedule-scroll]')
  const grid = document.querySelector('[data-schedule-grid]')
  const cell = document.querySelector('[data-course-cell]')
  const name = document.querySelector('[data-course-name]')
  const shell = document.querySelector('.app-viewport')
  return {
    htmlHeight: getComputedStyle(document.documentElement).height,
    bodyHeight: getComputedStyle(document.body).height,
    bodyDoc: document.body.scrollHeight,
    shellHeight: shell ? getComputedStyle(shell).height : null,
    gridClientH: grid.clientHeight,
    rows: getComputedStyle(grid).gridTemplateRows.split(' ').slice(1, 3).join(' '),
    clientH: scroller.clientHeight,
    scrollTop: scroller.scrollTop,
    scrollH: scroller.scrollHeight,
    maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
    cell: cell ? cell.clientWidth + 'x' + cell.clientHeight : null,
    nameFont: name ? getComputedStyle(name).fontSize + '/' + getComputedStyle(name).lineHeight : null,
    cells: document.querySelectorAll('[data-course-cell]').length,
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
 * 把 `html, body` 规则上的 `height` 整个拿掉（`100%` 与 `100dvh` 都删）——
 * 这才是**修复前**的等价状态：旧引擎忽略 `dvh`、且当时产物里也没有 `100%` 兜底。
 * 只动选择器归一化为 `html,body` 的规则，不碰 `.app-viewport` 自己那条 `height: 100%`。
 */
const BREAK_ANCHOR = `(() => {
  const touched = []
  const normalize = (value) => value.replace(/\\s+/g, ' ').replace(/\\s*,\\s*/g, ',').trim()
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule.style && normalize(rule.selectorText ?? '') === 'html,body') {
        if (rule.style.getPropertyValue('height')) {
          touched.push(rule.style.getPropertyValue('height'))
          rule.style.removeProperty('height')
        }
      }
      if (rule.cssRules) visit(rule.cssRules)
    }
  }
  for (const sheet of document.styleSheets) {
    try { visit(sheet.cssRules) } catch { /* 同源样式表，忽略跨域 */ }
  }
  return touched
})()`

/** 注入候选加固（按「目标引擎解析后的样子」注入，带 !important 以覆盖原位声明）。 */
const STYLE_ID = 'preventive-hardening-probe'
const inject = async (css) =>
  evaluate(`(() => {
    document.getElementById('${STYLE_ID}')?.remove()
    if (!${JSON.stringify(css)} ) return null
    const style = document.createElement('style')
    style.id = '${STYLE_ID}'
    style.textContent = ${JSON.stringify(css)}
    document.head.appendChild(style)
    return null
  })()`)

const reset = async () => {
  await inject('')
  await evaluate(`(() => { const el = document.querySelector('[data-schedule-scroll]'); el.scrollTop = 0; return null })()`)
  await sleep(150)
}

/** 一次纵向滚动试验。 */
const scrollTrial = async () => {
  await evaluate(`(() => { const el = document.querySelector('[data-schedule-scroll]'); el.scrollTop = 0; return null })()`)
  await sleep(120)
  const before = await probe()
  await verticalDrag(650, 350)
  const after = await probe()
  return { before, after, scrolled: after.scrollTop > before.scrollTop, reachedMax: after.scrollTop >= after.maxScrollTop }
}

const report = {}
const scenario = async (label, css, breakAnchor) => {
  await reset()
  if (css) await inject(css)
  if (breakAnchor) await evaluate(BREAK_ANCHOR)
  await sleep(200)
  report[label] = await scrollTrial()
  await reset()
}

/** A：网格最小高度兜底（构建产物里会折叠成 48.75rem）。 */
const A_CSS = '[data-schedule-grid]{min-height:48.75rem}'
/** C2：旧引擎会给外壳 100vh 锚点。 */
const C2_CSS = '.app-viewport{height:100vh;max-height:100vh}'

await scenario('0-基线（不改）', '', false)
await scenario('1-A（正常引擎 · 应逐项不变）', A_CSS, false)
await scenario('2-C2 注入（正常引擎 · 应逐项不变）', C2_CSS, false)
await scenario('3-锚点被拿掉（= 修复前状态 · 已知坏）', '', true)
await scenario('4-锚点被拿掉 + A', A_CSS, true)
await scenario('5-锚点被拿掉 + C2（外壳自带锚点）', C2_CSS, true)
await scenario('6-锚点被拿掉 + A + C2', `${A_CSS}${C2_CSS}`, true)

console.log(JSON.stringify(report, null, 2))
socket.close()
