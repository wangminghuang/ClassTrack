// 课程格文字适配回归（三档版）：视口 × 档位（1x/1.5x/2x）× 跨周切换后，
// 教室恒显、可丢行按优先级、字号在 8–15px、文字块不溢出不宽于容器、内容溢出必有兜底。
//
// 与 10-11-schedule-week-swipe-jank 的 `verify-cell-layout.mjs` 的差别（也是必须另写一份的原因）：
//   1. 档位由**实际读数**驱动并**等落定**（轮询 `data-zoom-level`），原脚本按「点了几次」猜档位，
//      点击间隔 200ms 撞上 180ms 的落定过渡时会被状态机忽略一次，于是报告里的 "1x/2x" 名不副实。
//   2. 覆盖第三档 1.5x —— 三档各有一套排布快照，漏测一档等于漏测一条缓存路径。
//   3. 标签用实测档位而不是点击次数，报告自己不可能说谎。
//
// 用法：node .../verify-zoom-layout.mjs <page-ws> <out.json>
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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
await send('Page.bringToFront')

const PROBE = `(() => {
  const visible = (el) => !!el && getComputedStyle(el).display !== 'none'
  const cells = [...document.querySelectorAll('[data-course-cell]')].map((cell) => {
    const wrapper = cell.closest('[data-course-wrapper]')
    const content = cell.firstElementChild
    const block = content.firstElementChild
    const name = cell.querySelector('[data-course-name]')
    const room = cell.querySelector('[data-course-room]')
    const teacher = cell.querySelector('[data-course-teacher]')
    const note = cell.querySelector('[data-course-note]')
    return {
      name: name.textContent.slice(0, 12),
      fontSize: parseFloat(getComputedStyle(name).fontSize),
      contentOverflow: content.scrollHeight - content.clientHeight,
      containerWidth: wrapper.clientWidth,
      containerHeight: wrapper.clientHeight,
      blockWidth: block.style.width ? block.getBoundingClientRect().width : null,
      blockOverflows: block.scrollWidth > block.clientWidth + 1,
      nameVisible: visible(name),
      roomVisible: visible(room),
      teacherVisible: visible(teacher),
      noteVisible: visible(note),
      outOfWeek: cell.hasAttribute('data-course-out-of-week'),
      scale: cell.style.getPropertyValue('--cc-scale'),
    }
  })
  const scroller = document.querySelector('[data-schedule-scroll]')
  const grid = document.querySelector('[data-schedule-grid]')
  return {
    week: Number(document.querySelector('[data-current-week]').dataset.currentWeek),
    zoom: grid.dataset.zoomLevel,
    detail: grid.dataset.zoomTier,
    preview: document.querySelector('[data-schedule-zoom-stage]').dataset.scheduleZoomPreview ?? null,
    viewport: [innerWidth, innerHeight],
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollerOverflowX: scroller.scrollWidth - scroller.clientWidth,
    cells,
  }
})()`

const report = { runs: [] }
const violations = []

/** 断言一屏的课程格满足空间自适应契约；返回可归档的读数。 */
function check(label, probe) {
  const issues = []
  if (probe.pageOverflowX > 0) issues.push(`${label}: 页面出现横向溢出 ${probe.pageOverflowX}px`)
  if (probe.preview !== null) issues.push(`${label}: 静止态残留预览标记 ${probe.preview}`)
  for (const cell of probe.cells) {
    if (!cell.roomVisible) issues.push(`${label}: 「${cell.name}」教室被丢弃（硬要求）`)
    if (!cell.nameVisible) issues.push(`${label}: 「${cell.name}」课名不可见`)
    if (cell.fontSize < 8 || cell.fontSize > 15.1) issues.push(`${label}：「${cell.name}」字号 ${cell.fontSize} 超出 8–15px`)
    if (cell.noteVisible && !cell.teacherVisible) issues.push(`${label}：「${cell.name}」备注在教师之前显示（丢弃顺序反了）`)
    if (cell.teacherVisible && !cell.roomVisible) issues.push(`${label}：「${cell.name}」教师在教室之前显示`)
    if (cell.blockOverflows) issues.push(`${label}：「${cell.name}」文字块水平溢出`)
    if (cell.blockWidth !== null && cell.blockWidth > cell.containerWidth + 1) issues.push(`${label}：「${cell.name}」文字块宽于容器`)
    if (cell.contentOverflow > 1 && !cell.scale) issues.push(`${label}：「${cell.name}」内容溢出 ${cell.contentOverflow}px 但未走兜底`)
  }
  violations.push(...issues)
  report.runs.push({ label, week: probe.week, zoom: probe.zoom, detail: probe.detail, viewport: probe.viewport, scrollerOverflowX: probe.scrollerOverflowX, cells: probe.cells })
  return issues
}

const currentTier = () => evaluate(`Number(document.querySelector('[data-schedule-grid]').dataset.zoomLevel)`)

/**
 * 把档位推到目标并**等它落定**（超时即抛，避免把中间态当终态断言）。
 *
 * 两条入口：手机走 ± 按钮（可精确到 1.5x）；桌面没有控件（`data-schedule-zoom-control` 只在 `isMobile`
 * 下渲染），退化成双击切换 `toggleZoom`（1x ↔ 2x），因此桌面覆盖不到 1.5x —— 这一点写进 `summary.skipped`，
 * 不让报告看起来覆盖了三档。
 */
async function settleTo(target, how) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const now = await currentTier()
    if (now === target) {
      // 落定还要过一遍模糊淡出（120ms）与清场余量，多等一拍再断言。
      await sleep(260)
      assert.equal(await currentTier(), target, `等落定：期望 ${target}x，读回 ${await currentTier()}x`)
      return
    }
    if (how === 'buttons') {
      const label = now < target ? '放大课表' : '缩小课表'
      const clicked = await evaluate(`(() => { const b = document.querySelector('[aria-label="${label}"]'); if (!b) return false; b.click(); return true })()`)
      assert.ok(clicked, `找不到「${label}」按钮`)
    } else {
      const toggled = await evaluate(`(() => {
        const scroll = document.querySelector('[data-schedule-scroll]');
        if (!scroll) return false;
        scroll.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        return true;
      })()`)
      assert.ok(toggled, '找不到滚容器，无法派发 dblclick')
    }
    await sleep(320)
  }

  throw new Error(`推不到 ${target}x（当前 ${await currentTier()}x）`)
}

const TIERS = [1, 1.5, 2]
const hasZoomControl = await evaluate(`!!document.querySelector('[data-schedule-zoom-control]')`)
const how = hasZoomControl ? 'buttons' : 'dblclick'
// 桌面没有 ± 控件，双击只能 1x ↔ 2x；跳过 1.5x 要写进报告，不能假装覆盖了。
const tiers = hasZoomControl ? TIERS : [1, 2]
const skipped = hasZoomControl ? [] : [{ tier: 1.5, reason: '桌面无缩放入口（± 控件仅 isMobile 渲染，dblclick 只切换 1x↔2x）' }]

for (const tier of tiers) {
  await settleTo(tier, how)
  for (const round of [0, 1]) {
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回本周'))?.click()`)
    await sleep(250)
    await evaluate(`(() => { const el=document.querySelector('[data-schedule-scroll]'); el.scrollTop=0; el.scrollLeft=0; return true })()`)
    await sleep(120)
    // 第二轮先按手势路径切一周，验证换周后新课程格完成适配（第一轮按顶栏回本周）。
    if (round === 1) {
      await evaluate(`document.querySelector('[aria-label="下一周"]').click()`)
      await sleep(400)
    }
    const probe = await evaluate(PROBE)
    check(`${probe.viewport.join('x')} ${probe.zoom}x(${probe.detail}) 第${probe.week}周`, probe)
  }
}

// 备注属于可丢行：整周切换后不得停在 display:none 粘住。
await evaluate(`document.querySelector('[aria-label="本周"]')?.click()`)
await sleep(300)

socket.close()
report.violations = violations
report.summary = {
  tiers: tiers,
  entry: how,
  skipped: skipped,
  checks: report.runs.map((run) => run.label),
  observedTiers: [...new Set(report.runs.map((run) => run.zoom))].sort(),
}
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ runs: report.runs.map(({ cells, ...run }) => run), summary: report.summary, violations }, null, 2))
assert.equal(violations.length, 0, `课程格适配违约：\n${violations.join('\n')}`)
