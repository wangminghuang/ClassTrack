// 静止态与降级验收（AC3 / AC4）：三条缩放入口走完之后，合成层必须回到「什么都没有」。
//
// 判据来自 design.md §10：stage 与滚容器上的内联 `transform` / `filter` / `transition` 全空、
// 计算值回到 `none`、`data-schedule-zoom-preview` 不存在、网格实际宽度落在预期档位上；
// `prefers-reduced-motion: reduce` 时过渡时长为 0（点下去就落定）且全程不加模糊。
//
// 相位读取用同步派发的 `PointerEvent`：真实触摸事件必须经过 CDP 往返，读到的是往返之后的状态，
// 无法稳定断言「过渡正在播」；同步派发可以在同一次求值里读到手势期与落定期。真实触摸路径另有
// 一条端到端用例（只验终态），观感口径由 `zoom-perf.mjs` 负责 —— 三者互为补充。
//
// 仅使用合成课表夹具数据，不接触任何真实用户数据。
// 用法：node .../verify-zoom-rest.mjs <page-ws> [out.json]
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

/**
 * 等多久才允许断言静止态。
 *
 * 必须覆盖最慢的一条收尾链：落定过渡（180ms，若 `transitionend` 未派发则再多等兜底余量
 * 120ms）+ 模糊淡出的起始帧（~16ms）+ 淡出（120ms）+ 清场余量（50ms）；双击入口还要额外
 * 覆盖 400ms 的去抖窗口。
 */
const SETTLE_WAIT_MS = 900

await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true })

/** 一次读回静止态 / 相位状态的全部观测点。 */
const READ_STATE = `(() => {
  const stage = document.querySelector('[data-schedule-zoom-stage]')
  const grid = document.querySelector('[data-schedule-grid]')
  const scroll = document.querySelector('[data-schedule-scroll]')
  const computed = getComputedStyle(stage)
  return {
    phase: stage.dataset.scheduleZoomPreview ?? null,
    inline: {
      stageTransform: stage.style.getPropertyValue('transform'),
      stageFilter: stage.style.getPropertyValue('filter'),
      stageTransition: stage.style.getPropertyValue('transition'),
      scrollTransform: scroll.style.getPropertyValue('transform'),
      scrollFilter: scroll.style.getPropertyValue('filter'),
    },
    computed: { transform: computed.transform, filter: computed.filter },
    zoomLevel: Number(grid.dataset.zoomLevel),
    zoomTier: grid.dataset.zoomTier ?? null,
    inlineZoom: grid.style.getPropertyValue('--schedule-zoom'),
    gridWidth: Math.round(grid.getBoundingClientRect().width * 100) / 100,
    containerWidth: scroll.clientWidth,
    scrollLeft: Math.round(scroll.scrollLeft),
    control: document.querySelector('[data-schedule-zoom-control] span')?.textContent ?? null,
  }
})()`

const readState = () => evaluate(READ_STATE)

/** 等到课程格挂载（reload 之后用）。 */
const waitForGrid = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await evaluate("!!document.querySelector('[data-course-cell]')")) return
    await sleep(100)
  }
  throw new Error('课程格未挂载')
}

/** 每条入口开跑前复位到 1x：缩放值不持久化，reload 即复位。 */
const resetToBase = async () => {
  await send('Page.reload')
  await waitForGrid()
  await sleep(300)
}

const report = []

/**
 * AC3 判据：合成层回到静止态，且档位落在预期值上。
 *
 * @param label 用例名（进报告与断言消息）。
 * @param state 静止态读数。
 * @param expectedTier 预期的已提交档位。
 */
const checkRest = (label, state, expectedTier) => {
  const problems = []
  if (state.phase !== null) problems.push(`stage 仍带 data-schedule-zoom-preview=${state.phase}`)
  for (const [key, value] of Object.entries(state.inline)) {
    if (value !== '') problems.push(`${key} 内联值未清空：${JSON.stringify(value)}`)
  }
  if (state.computed.transform !== 'none') problems.push(`stage 计算 transform=${state.computed.transform}`)
  if (state.computed.filter !== 'none') problems.push(`stage 计算 filter=${state.computed.filter}`)
  if (state.zoomLevel !== expectedTier) problems.push(`data-zoom-level=${state.zoomLevel}，期望 ${expectedTier}`)
  if (state.inlineZoom !== String(expectedTier)) problems.push(`--schedule-zoom=${state.inlineZoom}，期望 ${expectedTier}`)
  const expectedWidth = expectedTier * state.containerWidth
  if (Math.abs(state.gridWidth - expectedWidth) > 1) problems.push(`网格宽=${state.gridWidth}，期望 ${expectedWidth}`)
  if (state.control !== `${expectedTier}x`) problems.push(`档位读数=${state.control}，期望 ${expectedTier}x`)

  report.push({
    label,
    tier: expectedTier,
    gridWidth: state.gridWidth,
    containerWidth: state.containerWidth,
    scrollLeft: state.scrollLeft,
    zoomTier: state.zoomTier,
    problems,
  })
  assert.deepEqual(problems, [], `${label}：静止态不合格`)
  console.log(`ok  ${label}（tier=${expectedTier}，宽 ${state.gridWidth}px，scrollLeft=${state.scrollLeft}，分级 ${state.zoomTier}）`)
}

/** 派发两指捏合：同步读出手势期与落定期的相位。 */
const syntheticPinch = (from, to, steps = 40) =>
  evaluate(`(() => {
  const el = document.querySelector('[data-schedule-scroll]')
  const fire = (type, pointerId, x, y) =>
    el.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }))
  const centerX = 206
  const centerY = 400
  fire('pointerdown', 1, centerX - ${from} / 2, centerY)
  fire('pointerdown', 2, centerX + ${from} / 2, centerY)
  let half = ${from} / 2
  for (let step = 1; step <= ${steps}; step += 1) {
    half = (${from} + ((${to} - ${from}) * step) / ${steps}) / 2
    fire('pointermove', 1, centerX - half, centerY)
    fire('pointermove', 2, centerX + half, centerY)
  }
  const during = ${READ_STATE}
  fire('pointerup', 1, centerX - half, centerY)
  const afterRelease = ${READ_STATE}
  return { during, afterRelease }
})()`)

const point = (x, y, pointerId) => ({ x, y, id: pointerId, radiusX: 1, radiusY: 1, force: 1 })

/** 真实触摸路径的两指捏合（端到端，只验终态）。 */
const touchPinch = async (from, to, steps = 40) => {
  const centerX = 206
  const centerY = 400
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(centerX - from / 2, centerY, 1), point(centerX + from / 2, centerY, 2)],
  })
  for (let step = 1; step <= steps; step += 1) {
    const half = (from + ((to - from) * step) / steps) / 2
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(centerX - half, centerY, 1), point(centerX + half, centerY, 2)],
    })
    await sleep(16)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** 点一次按钮，并同步读出点击之后的相位。 */
const clickZoomButton = (label) =>
  evaluate(`(() => {
  const button = document.querySelector('[data-schedule-zoom-control] button[aria-label="${label}"]')
  if (!button || button.disabled) throw new Error('按钮不可用：${label}')
  button.click()
  return ${READ_STATE}
})()`)

/** 派发一次双击（走容器的 onDoubleClick）。 */
const dispatchDoubleClick = () =>
  evaluate(`(() => {
  const el = document.querySelector('[data-schedule-scroll]')
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  return ${READ_STATE}
})()`)

const setReducedMotion = (enabled) =>
  send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: enabled ? 'reduce' : 'no-preference' }],
  })

// ── 1. 正常动效：三条入口的相位与终态 ───────────────────────────────────────────
console.log('--- prefers-reduced-motion: no-preference ---')
await setReducedMotion(false)

// 1a. 双指捏合（合成 pointer：能同步读到手势期与落定期）
// 捏到 1.67 倍就松手：吸附目标是 1.5x，合成层要真的从 1.67 播回 1.5，所以松手瞬间处于 settling。
await resetToBase()
const pinch = await syntheticPinch(60, 100)
assert.equal(pinch.during.phase, 'preview', '手势期应处于 preview')
assert.notEqual(pinch.during.inline.stageTransform, '', '手势期合成层应有内联 transform')
assert.equal(pinch.during.inlineZoom, '1', '手势期不得改 --schedule-zoom（宽度冻结在当前档位）')
assert.equal(pinch.during.zoomLevel, 1, '手势期不得提交新档位')
assert.equal(pinch.afterRelease.phase, 'settling', '松手瞬间应处于 settling（过渡在播，不是直接落定）')
assert.notEqual(pinch.afterRelease.inline.stageTransition, '', 'settling 应带 transform 过渡')
assert.equal(pinch.afterRelease.inlineZoom, '1', 'settling 期间宽度仍冻结在起始档位（落定那一刻才换）')
await sleep(SETTLE_WAIT_MS)
checkRest('双指捏合 1x→1.5x（需播回档位）', await readState(), 1.5)

// 捏到正好 2 倍再松手：预览比例已经等于目标比例，没有可播的过渡，应直接落定。
await resetToBase()
const pinchToTier = await syntheticPinch(60, 120)
assert.equal(pinchToTier.afterRelease.phase, null, '比例已在目标档位上时应直接落定，不留 settling')
assert.equal(pinchToTier.afterRelease.inlineZoom, '2', '直接落定路径应在同一次求值里就换上目标宽度')
assert.notEqual(pinchToTier.afterRelease.inline.stageFilter, '', '落定之后模糊还要再留一个绘制帧才淡出')
await sleep(SETTLE_WAIT_MS)
checkRest('双指捏合 1x→2x（无需播回）', await readState(), 2)

// 1b. 真实触摸的同一段手势（CDP 派发，端到端）
await resetToBase()
await touchPinch(60, 132)
await sleep(SETTLE_WAIT_MS + 200)
checkRest('双指捏合（真实触摸）1x→2x', await readState(), 2)

// 1c. ± 按钮：连点四次走满 1 → 1.5 → 2 → 1.5 → 1
await resetToBase()
assert.equal((await clickZoomButton('放大课表')).phase, 'settling', '点 + 应立即进入 settling')
await sleep(SETTLE_WAIT_MS)
checkRest('+ 按钮 1x→1.5x', await readState(), 1.5)
assert.equal((await clickZoomButton('放大课表')).phase, 'settling', '再点 + 应立即进入 settling')
await sleep(SETTLE_WAIT_MS)
checkRest('+ 按钮 1.5x→2x', await readState(), 2)
assert.equal((await clickZoomButton('缩小课表')).phase, 'settling', '点 − 应立即进入 settling')
await sleep(SETTLE_WAIT_MS)
checkRest('− 按钮 2x→1.5x', await readState(), 1.5)
assert.equal((await clickZoomButton('缩小课表')).phase, 'settling', '再点 − 应立即进入 settling')
await sleep(SETTLE_WAIT_MS)
checkRest('− 按钮 1.5x→1x', await readState(), 1)

// 1d. 双击（1x ↔ 2x）
await resetToBase()
assert.equal((await dispatchDoubleClick()).phase, 'settling', '双击应立即进入 settling')
await sleep(SETTLE_WAIT_MS)
checkRest('双击 1x→2x', await readState(), 2)
assert.equal((await dispatchDoubleClick()).phase, 'settling', '再次双击应立即进入 settling')
await sleep(SETTLE_WAIT_MS)
checkRest('双击 2x→1x', await readState(), 1)

// ── 2. 减少动效：过渡时长为 0，点下去就落定，且全程不加模糊 ────────────────────
console.log('--- prefers-reduced-motion: reduce ---')
await setReducedMotion(true)

await resetToBase()
const reducedPinch = await syntheticPinch(60, 100)
assert.equal(reducedPinch.during.phase, 'preview', 'reduce 下手势期仍是 preview（跟手不是动效）')
assert.equal(reducedPinch.during.inline.stageFilter, '', 'reduce 下手势期不得加模糊')
assert.equal(reducedPinch.afterRelease.phase, null, 'reduce 下松手应立刻落定，不留在 settling')
checkRest('reduce 双指捏合 1x→1.5x', await readState(), 1.5)

await resetToBase()
assert.equal((await clickZoomButton('放大课表')).phase, null, 'reduce 下点 + 应立刻落定')
checkRest('reduce + 按钮 1x→1.5x', await readState(), 1.5)

await resetToBase()
assert.equal((await dispatchDoubleClick()).phase, null, 'reduce 下双击应立刻落定')
checkRest('reduce 双击 1x→2x', await readState(), 2)

await setReducedMotion(false)

if (output) writeFileSync(output, JSON.stringify({ report }, null, 2) + '\n')
console.log(`\n全部通过：${report.length} 处静止态检查`)
socket.close()
