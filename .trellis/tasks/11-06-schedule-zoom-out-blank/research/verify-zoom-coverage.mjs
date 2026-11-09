// 产品路径验收：双指 / ± / 双击的缩小覆盖、无模糊、终态与减少动效。
// 仅使用合成课表夹具。用法：node verify-zoom-coverage.mjs <page-ws> [out.json] [midpoint.png]
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const [url, output, screenshot] = process.argv.slice(2)
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
const SETTLE_WAIT_MS = 700

const READ_STATE = `(() => {
  const stage = document.querySelector('[data-schedule-zoom-stage]')
  const grid = document.querySelector('[data-schedule-grid]')
  const scroll = document.querySelector('[data-schedule-scroll]')
  const gridRect = grid.getBoundingClientRect()
  const scrollRect = scroll.getBoundingClientRect()
  const contentLeft = scrollRect.left + scroll.clientLeft
  const gridComputed = getComputedStyle(grid)
  return {
    phase: stage.dataset.scheduleZoomPreview ?? null,
    left: gridRect.left - contentLeft,
    right: gridRect.right - contentLeft,
    viewportWidth: scroll.clientWidth,
    gridLayoutWidth: grid.offsetWidth,
    zoomLevel: Number(grid.dataset.zoomLevel),
    inlineZoom: grid.style.getPropertyValue('--schedule-zoom'),
    scrollLeft: scroll.scrollLeft,
    scrollWidth: scroll.scrollWidth,
    inline: {
      gridTransform: grid.style.getPropertyValue('transform'),
      gridFilter: grid.style.getPropertyValue('filter'),
      gridTransition: grid.style.getPropertyValue('transition'),
      stageTransform: stage.style.getPropertyValue('transform'),
      stageFilter: stage.style.getPropertyValue('filter'),
      stageTransition: stage.style.getPropertyValue('transition'),
      scrollFilter: scroll.style.getPropertyValue('filter'),
    },
    computed: { transform: gridComputed.transform, filter: gridComputed.filter, origin: gridComputed.transformOrigin },
    textFilters: [...document.querySelectorAll('[data-course-content]')].map((el) => getComputedStyle(el).filter),
  }
})()`
const readState = () => evaluate(READ_STATE)
const report = []

const checkCoverage = (label, state, expectedPhase) => {
  const problems = []
  if (state.phase !== expectedPhase) problems.push(`相位=${state.phase}，期望 ${expectedPhase}`)
  if (!state.inline.gridTransform.includes('scaleX')) problems.push('完整网格缺少 scaleX 预览')
  if (state.left > 0.5) problems.push(`左侧空缺 ${state.left}px`)
  if (state.right < state.viewportWidth - 0.5) problems.push(`右侧空缺 ${state.viewportWidth - state.right}px`)
  for (const [key, value] of Object.entries(state.inline)) {
    if (key.toLowerCase().includes('filter') && value !== '') problems.push(`${key} 不应有模糊：${value}`)
  }
  if (state.computed.filter !== 'none') problems.push(`计算 filter=${state.computed.filter}`)
  if (state.computed.origin !== '0px 0px') problems.push(`变换原点=${state.computed.origin}`)
  if (!state.textFilters.every((filter) => filter === 'blur(0.8px)')) problems.push(`课程文字应局部 blur(0.8px)：${state.textFilters}`)
  report.push({ label, kind: 'live', expectedPhase, state, problems })
  assert.deepEqual(problems, [], `${label}：预览不合格`)
}

const checkRest = (label, state, expectedTier) => {
  const problems = []
  if (state.phase !== null) problems.push(`相位残留 ${state.phase}`)
  for (const [key, value] of Object.entries(state.inline)) {
    if (value !== '') problems.push(`${key} 内联值未清空：${JSON.stringify(value)}`)
  }
  if (state.computed.transform !== 'none') problems.push(`计算 transform=${state.computed.transform}`)
  if (state.computed.filter !== 'none') problems.push(`计算 filter=${state.computed.filter}`)
  if (!state.textFilters.every((filter) => filter === 'none')) problems.push(`静止态课程文字仍带模糊：${state.textFilters}`)
  if (state.zoomLevel !== expectedTier) problems.push(`档位=${state.zoomLevel}，期望 ${expectedTier}`)
  if (state.inlineZoom !== String(expectedTier)) problems.push(`--schedule-zoom=${state.inlineZoom}`)
  const expectedWidth = expectedTier * state.viewportWidth
  if (Math.abs(state.gridLayoutWidth - expectedWidth) > 1) problems.push(`网格布局宽=${state.gridLayoutWidth}，期望 ${expectedWidth}`)
  if (Math.abs(state.scrollWidth - expectedWidth) > 1) problems.push(`滚动宽=${state.scrollWidth}，期望 ${expectedWidth}`)
  report.push({ label, kind: 'rest', expectedTier, state, problems })
  assert.deepEqual(problems, [], `${label}：静止态不合格`)
}

const clickZoom = (label) =>
  evaluate(`(() => {
    const button = document.querySelector('[data-schedule-zoom-control] button[aria-label="${label}"]')
    if (!button || button.disabled) throw new Error('按钮不可用：${label}')
    button.click()
    return ${READ_STATE}
  })()`)
const doubleClick = () =>
  evaluate(`(() => {
    document.querySelector('[data-schedule-scroll]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    return ${READ_STATE}
  })()`)
const currentTier = () => evaluate("Number(document.querySelector('[data-schedule-grid]').dataset.zoomLevel)")
const ensureTier = async (target) => {
  for (let guard = 0; guard < 5 && (await currentTier()) !== target; guard += 1) {
    const direction = (await currentTier()) < target ? '放大课表' : '缩小课表'
    await clickZoom(direction)
    await sleep(SETTLE_WAIT_MS)
  }
  assert.equal(await currentTier(), target, `无法到达 ${target}x`)
}
const setScrollRatio = (ratio) =>
  evaluate(`(() => {
    const scroll = document.querySelector('[data-schedule-scroll]')
    scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) * ${ratio}
    return scroll.scrollLeft
  })()`)

await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

// − 按钮：三个滚动位置都经过 2→1.5→1，同步读 settling 中间态。
for (const scrollRatio of [0, 0.5, 1]) {
  await ensureTier(2)
  await setScrollRatio(scrollRatio)
  const middle = await clickZoom('缩小课表')
  checkCoverage(`−按钮 2x→1.5x / scroll=${scrollRatio}`, middle, 'settling')
  await sleep(SETTLE_WAIT_MS)
  checkRest(`−按钮 1.5x 终态 / scroll=${scrollRatio}`, await readState(), 1.5)
  const minimum = await clickZoom('缩小课表')
  checkCoverage(`−按钮 1.5x→1x / scroll=${scrollRatio}`, minimum, 'settling')
  await sleep(SETTLE_WAIT_MS)
  checkRest(`−按钮 1x 终态 / scroll=${scrollRatio}`, await readState(), 1)
}

// 双击：2→1 同样不能以视口半宽结束动画。
for (const scrollRatio of [0, 0.5, 1]) {
  await ensureTier(2)
  await setScrollRatio(scrollRatio)
  const live = await doubleClick()
  checkCoverage(`双击 2x→1x / scroll=${scrollRatio}`, live, 'settling')
  await sleep(SETTLE_WAIT_MS)
  checkRest(`双击 1x 终态 / scroll=${scrollRatio}`, await readState(), 1)
  await sleep(450)
}

// 合成 pointer 可以在同一次求值里读到手势期，不依赖 CDP 往返时序。
const syntheticPinch = (scale, centerRatio) =>
  evaluate(`(() => {
    const el = document.querySelector('[data-schedule-scroll]')
    const rect = el.getBoundingClientRect()
    const centerX = rect.left + el.clientLeft + el.clientWidth * ${centerRatio}
    const centerY = rect.top + Math.min(300, el.clientHeight / 2)
    const from = 120
    const to = from * ${scale}
    const fire = (type, pointerId, x, y) =>
      el.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }))
    fire('pointerdown', 1, centerX - from / 2, centerY)
    fire('pointerdown', 2, centerX + from / 2, centerY)
    for (let step = 1; step <= 20; step += 1) {
      const half = (from + ((to - from) * step) / 20) / 2
      fire('pointermove', 1, centerX - half, centerY)
      fire('pointermove', 2, centerX + half, centerY)
    }
    const during = ${READ_STATE}
    fire('pointerup', 1, centerX - to / 2, centerY)
    const afterRelease = ${READ_STATE}
    fire('pointerup', 2, centerX + to / 2, centerY)
    return { during, afterRelease }
  })()`)

for (const scrollRatio of [0, 0.5, 1]) {
  for (const centerRatio of [0.25, 0.5, 0.75]) {
    for (const scale of [0.75, 0.5]) {
      await ensureTier(2)
      await setScrollRatio(scrollRatio)
      const result = await syntheticPinch(scale, centerRatio)
      const label = `双指 2x→${2 * scale}x / scroll=${scrollRatio} / focus=${centerRatio}`
      checkCoverage(label, result.during, 'preview')
      assert.equal(result.during.gridLayoutWidth, 2 * result.during.viewportWidth, `${label}：手势期真实网格宽度被改`)
      assert.equal(result.during.zoomLevel, 2, `${label}：手势期提交了 React 档位`)
      if (screenshot && scrollRatio === 0 && centerRatio === 0.5 && scale === 0.5) {
        // 上面已经 pointerup，此用例直接落定；另起一次按住手势保存真正的 preview 中间帧。
        await ensureTier(2)
        await setScrollRatio(0)
        await evaluate(`(() => {
          const el = document.querySelector('[data-schedule-scroll]')
          const rect = el.getBoundingClientRect()
          const x = rect.left + el.clientLeft + el.clientWidth / 2
          const y = rect.top + Math.min(300, el.clientHeight / 2)
          const fire = (type, id, px) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: px, clientY: y, bubbles: true, cancelable: true }))
          fire('pointerdown', 11, x - 60)
          fire('pointerdown', 12, x + 60)
          fire('pointermove', 11, x - 30)
          fire('pointermove', 12, x + 30)
        })()`)
        const image = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(screenshot, Buffer.from(image.data, 'base64'))
        await evaluate(`(() => {
          const el = document.querySelector('[data-schedule-scroll]')
          el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, pointerType: 'touch', bubbles: true }))
          el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, pointerType: 'touch', bubbles: true }))
        })()`)
        await sleep(SETTLE_WAIT_MS)
      }
      await sleep(SETTLE_WAIT_MS)
      checkRest(`${label} 终态`, await readState(), 2 * scale)
    }
  }
}

// 非整数落点会播回 1.5x，验证 pinch settling 也保持覆盖。
await ensureTier(2)
await setScrollRatio(0.5)
const snapped = await syntheticPinch(0.8, 0.5)
checkCoverage('双指 2x→1.6x preview', snapped.during, 'preview')
checkCoverage('双指 1.6x→1.5x settling', snapped.afterRelease, 'settling')
await sleep(SETTLE_WAIT_MS)
checkRest('双指吸附 1.5x 终态', await readState(), 1.5)

// 减少动效：按钮直接落定，任何阶段都没有模糊。
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await ensureTier(2)
const reduced = await clickZoom('缩小课表')
assert.equal(reduced.phase, null, 'reduce 下不得停留 settling')
assert.equal(reduced.inline.gridFilter, '', 'reduce 下不得出现模糊')
assert.equal(reduced.inline.gridTransform, '', 'reduce 下不得残留预览变换')
await sleep(SETTLE_WAIT_MS)
checkRest('reduce 静止态', await readState(), 1.5)

if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(`PASS: ${report.filter((entry) => entry.kind === 'live').length} 个中间态 + ${report.filter((entry) => entry.kind === 'rest').length} 个静止态；无空白、无整表模糊，课程文字局部模糊按相位恢复`)
socket.close()
