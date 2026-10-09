/**
 * 设备端「课表能不能上下滑」一键诊断（任务 `09-29-fix-schedule-scroll-legacy-webview` 的 AC-8）。
 *
 * 用途：把「第二个原因未知」压成一次读判定 —— 直接告诉你故障落在**哪一层**，而不是继续猜：
 *
 * | 判定 | 含义 | 下一步 |
 * | --- | --- | --- |
 * | `needs-no-scroll` | 内容本来就装得下（没有被裁的内容） | 不是 bug，「滑不动」是正常的 |
 * | `layout-anchor` | **有内容被裁，但滚动容器没有滚动量** | 高度锚点/布局层：`html/body` 那层高度链塌了（本次已修 + C2 兜底） |
 * | `scroll-disabled` | 有滚动量，但程序化滚动都不动 | CSS/JS 层：`overflow` 被改 / 祖先禁用滚动 |
 * | `touch-layer` | 有滚动量且程序化可滚，但手指滑不动 | 触摸/事件层：祖先 `touch-action`、内联 `transform`、手势层、系统手势 |
 * | `ok` | 有滚动量、程序化可滚，且没有证据说明触摸有问题 | — |
 *
 * 用法：
 *
 *   node research/device-diagnostics.mjs --print-snippet          # 打印自包含表达式，贴进 WebView devtools 即可
 *   node research/device-diagnostics.mjs <cdp-ws-url>             # 连上去跑（ws url 取自 adb forward 的 devtools）
 *   node research/device-diagnostics.mjs <cdp-ws-url> --touch-failed   # 手指实测滑不动时带上这个开关
 *
 * 想让它报 `touch-layer`，必须显式给 `--touch-failed`：脚本在页面里**无法**派发会驱动原生滚动的触摸事件，
 * 所以「手指滑不动」这个事实只能由使用者提供（Chrome 里合成的 `TouchEvent` 不会驱动原生滚动）。
 */
const VERDICT_HINTS = {
  'needs-no-scroll': ['内容没有超出容器，本来就不需要滚动；若屏幕上确实看到被裁的内容，说明裁剪发生在更外层'],
  'layout-anchor': [
    '没有滚动量、但有内容看不到 —— 高度锚点/布局层问题。两种签名：',
    '① 外壳（html/body/.app-viewport）比 innerHeight 高 → 底部被 body{overflow:hidden} 裁掉；',
    '② 滚动容器自己长到了内容高度 → 容器内被裁',
    '先看 anchors：正常情况下三个高度都应等于（或略小于）innerHeight',
    '确认 APK 含 09-29 的修复：html/body 的 height:100% 兜底 + @supports (height: 100dvh) 升级 + 外壳 @supports not 兜底',
  ],
  'scroll-disabled': [
    '滚动量存在但程序化滚动不动 —— 检查祖先链上是否有 overflow 覆盖或滚动被禁用',
    '对照 ancestors 里的 overflowY / inlineTransform',
  ],
  'touch-layer': [
    '滚动量真实存在且程序化可滚 → 问题在触摸/事件层',
    '逐条对照 ancestors：某层 touch-action 若不是 auto/pan-x pan-y，或滚动容器上有内联 transform，优先怀疑它',
    '把「个人中心 → 课表显示 → 左右边缘滑动切换周」关掉再试（排除手势层监听器）',
    '若关掉仍滑不动，考虑 WebView 自身的嵌套滚动或系统手势（需要换设备/版本对照）',
  ],
  ok: ['没发现异常；若手指仍滑不动，带上 --touch-failed 再跑一次'],
}

/** 自包含诊断表达式（可直接贴进 devtools / WebView CDP 的 Runtime.evaluate）。 */
export const DIAGNOSTIC_SNIPPET = `(() => {
  const scroller = document.querySelector('[data-schedule-scroll]')
  if (!scroller) return { verdict: 'not-schedule-page', error: '找不到 [data-schedule-scroll]：不在课表页或还没渲染完成' }

  const computed = (el, prop) => (el ? getComputedStyle(el)[prop] : null)
  const chromeVersion = (navigator.userAgent.match(/Chrome\\/([0-9]+)/) || [])[1] || null

  const shell = document.querySelector('.app-viewport')
  const anchors = {
    innerHeight: window.innerHeight,
    html: computed(document.documentElement, 'height'),
    body: computed(document.body, 'height'),
    appViewport: computed(shell, 'height'),
  }

  const ancestors = []
  for (let el = scroller; el && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el)
    ancestors.push({
      tag: el.tagName.toLowerCase(),
      className: String(el.className || '').slice(0, 80),
      touchAction: style.touchAction,
      overflowY: style.overflowY,
      inlineTransform: el.style.transform || '',
    })
  }

  const range = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const rows = Array.prototype.slice.call(document.querySelectorAll('[data-section-row]'))
  const lastRow = rows.length ? rows[rows.length - 1] : null
  const viewportBottom = scroller.getBoundingClientRect().top + scroller.clientHeight
  const clipped = lastRow ? lastRow.getBoundingClientRect().bottom > viewportBottom + 1 : null

  const before = scroller.scrollTop
  const target = Math.min(range, 32)
  scroller.scrollTop = target
  const programmaticWorks = target > 0 ? scroller.scrollTop > before : null
  scroller.scrollTop = before

  const hasInlineTransform = ancestors.some((entry) => entry.inlineTransform)
  const oddTouchAction = ancestors.filter((entry) => entry.touchAction !== 'auto' && entry.touchAction !== 'pan-x pan-y')

  return {
    chromeVersion,
    userAgent: navigator.userAgent,
    anchors,
    scroller: {
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      scrollLeft: scroller.scrollLeft,
      maxScrollTop: range,
      touchAction: computed(scroller, 'touchAction'),
      overflowY: computed(scroller, 'overflowY'),
      overscrollBehaviorY: computed(scroller, 'overscrollBehaviorY'),
      inlineTransform: scroller.style.transform || '',
    },
    clipped,
    programmaticWorks,
    ancestors,
    signals: {
      anchorTallerThanViewport: parseFloat(anchors.html) > window.innerHeight + 1,
      hasInlineTransform,
      oddTouchAction,
    },
  }
})()`

/**
 * 由诊断原始数据给出判定与提示。
 *
 * @param {object} report `DIAGNOSTIC_SNIPPET` 的返回值。
 * @param {{ touchFailed?: boolean }} [options] 使用者是否已确认「手指滑不动」。
 * @returns {{ verdict: string, hints: string[] }}
 */
export function judge(report, { touchFailed = false } = {}) {
  if (!report || report.verdict === 'not-schedule-page') {
    return { verdict: 'not-schedule-page', hints: ['打开课表页再跑；dev server / App 冷启动后需等表格渲染出 [data-course-cell]'] }
  }

  const range = report.scroller.maxScrollTop
  const anchorCollapsed = report.signals?.anchorTallerThanViewport === true
  let verdict
  if (range > 0) {
    // 有滚动量：先看程序化滚动是否真的动（不动 = 滚动被禁用）
    if (report.programmaticWorks === false) verdict = 'scroll-disabled'
    else if (touchFailed) verdict = 'touch-layer'
    else verdict = 'ok'
  } else if (anchorCollapsed || report.clipped) {
    // 没有滚动量，还有内容看不到：高度锚点/布局层
    // （外壳比视口高 = 底部被 body{overflow:hidden} 裁掉；容器内被裁 = 容器长到了内容高度）
    verdict = 'layout-anchor'
  } else {
    verdict = 'needs-no-scroll'
  }

  return { verdict, hints: VERDICT_HINTS[verdict] ?? [] }
}

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

/** 连上 CDP 跑一次诊断。 */
async function runOverCdp(wsUrl, { touchFailed }) {
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

  const result = await new Promise((resolve, reject) => {
    const id = nextId
    nextId += 1
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: DIAGNOSTIC_SNIPPET, returnByValue: true } }))
  })

  socket.close()

  if (result.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`)
  return result.result.value
}

const args = process.argv.slice(2)
const touchFailed = args.includes('--touch-failed')
const wsUrl = args.find((arg) => !arg.startsWith('--'))

if (args.includes('--print-snippet') || !wsUrl) {
  if (!args.includes('--print-snippet') && !wsUrl) {
    console.log('# 没给 CDP ws url，下面按 --print-snippet 处理\n')
  }
  console.log(DIAGNOSTIC_SNIPPET)
} else {
  const report = await runOverCdp(wsUrl, { touchFailed })
  const { verdict, hints } = judge(report, { touchFailed })
  console.log(JSON.stringify({ verdict, hints, ...report }, null, 2))
}
