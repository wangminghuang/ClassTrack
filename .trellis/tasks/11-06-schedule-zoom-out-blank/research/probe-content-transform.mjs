// 规划期动态探针：不改产品源码，直接在当前生产页面上把预览变换临时移到完整网格，
// 验证缩小时的覆盖边界，以及 transform 是否会让浏览器自动改掉 scrollLeft / scrollWidth。
// 用法：node probe-content-transform.mjs <page-ws> [out.json]
import { writeFileSync } from 'node:fs'

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

await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
for (const label of ['放大课表', '放大课表']) {
  await evaluate(`document.querySelector('[data-schedule-zoom-control] button[aria-label="${label}"]').click()`)
  await sleep(500)
}

const report = []
for (const scrollRatio of [0, 0.5, 1]) {
  for (const centerRatio of [0.25, 0.5, 0.75]) {
    for (const scale of [0.75, 0.5]) {
      const before = await evaluate(`(() => {
        const scroll = document.querySelector('[data-schedule-scroll]')
        const grid = document.querySelector('[data-schedule-grid]')
        const stage = document.querySelector('[data-schedule-zoom-stage]')
        stage.style.removeProperty('transform')
        stage.style.removeProperty('filter')
        stage.style.removeProperty('transition')
        grid.style.removeProperty('transform')
        grid.style.removeProperty('transform-origin')
        grid.style.removeProperty('transition')
        scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) * ${scrollRatio}
        return { scrollLeft: scroll.scrollLeft, scrollWidth: scroll.scrollWidth, viewportWidth: scroll.clientWidth, contentWidth: grid.offsetWidth }
      })()`)
      const immediate = await evaluate(`(() => {
        const scroll = document.querySelector('[data-schedule-scroll]')
        const grid = document.querySelector('[data-schedule-grid]')
        const scale = ${scale}
        const centerX = scroll.clientWidth * ${centerRatio}
        const contentCenterX = ${before.scrollLeft} + centerX
        const raw = contentCenterX * (1 - scale)
        const min = ${before.scrollLeft} + scroll.clientWidth - grid.offsetWidth * scale
        const max = ${before.scrollLeft}
        const translateX = min <= max ? Math.min(Math.max(raw, min), max) : (min + max) / 2
        grid.style.transformOrigin = '0 0'
        grid.style.transform = 'translateX(' + translateX + 'px) scaleX(' + scale + ')'
        const rect = grid.getBoundingClientRect()
        const viewport = scroll.getBoundingClientRect()
        return { translateX, raw, min, max, left: rect.left - viewport.left, right: rect.right - viewport.left, viewportWidth: scroll.clientWidth, scrollLeft: scroll.scrollLeft, scrollWidth: scroll.scrollWidth }
      })()`)
      await sleep(50)
      const afterFrame = await evaluate(`(() => {
        const scroll = document.querySelector('[data-schedule-scroll]')
        const grid = document.querySelector('[data-schedule-grid]')
        const rect = grid.getBoundingClientRect()
        const viewport = scroll.getBoundingClientRect()
        return { left: rect.left - viewport.left, right: rect.right - viewport.left, scrollLeft: scroll.scrollLeft, scrollWidth: scroll.scrollWidth }
      })()`)
      report.push({ scrollRatio, centerRatio, scale, before, immediate, afterFrame })
      console.log(JSON.stringify(report[report.length - 1]))
    }
  }
}

await evaluate(`(() => {
  const grid = document.querySelector('[data-schedule-grid]')
  grid.style.removeProperty('transform')
  grid.style.removeProperty('transform-origin')
  grid.style.removeProperty('transition')
})()`)
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
socket.close()
