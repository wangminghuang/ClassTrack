// 性能诊断：真实 CDP 横滑 + 松手后帧间隔与主线程长任务；仅使用合成课表数据。
// 用法：node .../week-switch-perf.mjs <page-ws> [cpu-rate=4] [output.json]
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const [url, rate = '4', output] = process.argv.slice(2)
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
const point = (x, y) => ({ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 })
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true })
await send('Emulation.setCPUThrottlingRate', { rate: Number(rate) })
if (process.env.PROFILE === '1') await send('Profiler.enable')
if (process.env.PROFILE === '1') await send('Profiler.start')
const report = { cpuRate: Number(rate), environment: await evaluate(`({ua:navigator.userAgent,width:innerWidth,height:innerHeight,cells:document.querySelectorAll('[data-course-cell]').length})`), runs: [] }
await evaluate(`(() => {
  window.__weekPerf = null;
  const el = document.querySelector('[data-schedule-scroll]');
  el.addEventListener('touchend', () => {
    const p = window.__weekPerf;
    if (p) p.release = performance.now();
  }, {passive:true});
  const observer = new PerformanceObserver(list => {
    const p = window.__weekPerf;
    if (p) p.tasks.push(...list.getEntries().map(e => ({start:e.startTime,duration:e.duration})));
  });
  observer.observe({entryTypes:['longtask']});
  return true;
})()`)
for (let index = 0; index < 6; index++) {
  const direction = index % 2 === 0 ? 1 : -1
  const before = await evaluate(`Number(document.querySelector('[data-current-week]').dataset.currentWeek)`)
  await evaluate(`(() => {
    const el=document.querySelector('[data-schedule-scroll]'); el.scrollTop=0; el.scrollLeft=0;
    const p=window.__weekPerf={start:performance.now(),release:null,frames:[],tasks:[],weekChanges:[]};
    let week=Number(document.querySelector('[data-current-week]').dataset.currentWeek);
    const tick=t => {
      if(window.__weekPerf!==p) return;
      const next=Number(document.querySelector('[data-current-week]').dataset.currentWeek);
      if(next!==week){p.weekChanges.push({t,week:next});week=next;}
      p.frames.push(t);
      if(t-p.start<5000) requestAnimationFrame(tick);
    }; requestAnimationFrame(tick); return true;
  })()`)
  const from = direction === 1 ? 110 : 310
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from, 350)] })
  for (let step = 1; step <= 12; step++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(from + direction * step * 200 / 12, 350)] })
    await sleep(16)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(3000)
  const result = await evaluate(`(() => {
    const p=window.__weekPerf;
    const el=document.querySelector('[data-schedule-scroll]');
    return {...p,week:Number(document.querySelector('[data-current-week]').dataset.currentWeek),state:el.dataset.weekSwipeState,transform:el.style.transform,opacity:el.style.opacity};
  })()`)
  const gaps = result.frames.slice(1).map((t, n) => ({ start: result.frames[n], end: t, gap: t - result.frames[n] }))
    .filter((g) => g.end >= result.release && g.start < result.release + 400)
  const tasks = result.tasks.filter((t) => t.start + t.duration >= result.release && t.start < result.release + 400)
  const run = { direction: direction === 1 ? 'previous' : 'next', before, after: result.week, release: result.release, weekChanges: result.weekChanges, maxFrameGap: Math.max(...gaps.map((g) => g.gap)), longTasks: tasks, finalState: result.state, transform: result.transform, opacity: result.opacity, frameGaps: gaps }
  report.runs.push(run)
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...run, frameGaps: undefined }))
  assert.equal(result.week, before - direction, '手势必须恰好切换一周')
  assert.equal(result.state, 'idle')
  assert.equal(result.transform, '')
  assert.equal(result.opacity, '')
}
if (process.env.PROFILE === '1') {
  const { profile } = await send('Profiler.stop')
  writeFileSync(output + '.cpuprofile', JSON.stringify(profile))
}
await send('Emulation.setCPUThrottlingRate', { rate: 1 })
socket.close()
report.summary = { worstFrameGap: Math.max(...report.runs.map((r) => r.maxFrameGap)), worstLongTask: Math.max(0, ...report.runs.flatMap((r) => r.longTasks.map((t) => t.duration))) }
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ environment: report.environment, summary: report.summary }, null, 2))
if (process.env.PERF_ASSERT === '1') {
  assert.ok(report.summary.worstLongTask < 50, '松手切周不得出现 >=50ms 主线程长任务')
}
