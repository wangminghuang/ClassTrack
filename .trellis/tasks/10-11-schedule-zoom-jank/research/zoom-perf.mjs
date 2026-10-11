// 性能诊断：手机课表缩放的两种口径 —— (A) 真实双指捏合触摸，(B) 合成 rAF 扫档。
// B 直接驱动「改 --schedule-zoom → 课程格 ResizeObserver → fitCourseCells」，用来把
// JS 测量开销与 CDP 派发延迟分开；A 用来确认真实输入下的观感口径。
// 仅使用合成课表夹具数据，不接触任何真实用户数据。
// 用法：node .../zoom-perf.mjs <page-ws> [cpu-rate=1] [output.json] [mode=touch|sweep|both]
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const [url, rate = '1', output, mode = 'both'] = process.argv.slice(2)
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
const point = (x, y, pointerId) => ({ x, y, id: pointerId, radiusX: 1, radiusY: 1, force: 1 })

await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true })
await send('Emulation.setCPUThrottlingRate', { rate: Number(rate) })
if (process.env.PROFILE === '1') await send('Profiler.enable')
if (process.env.PROFILE === '1') await send('Profiler.start')

const report = {
  cpuRate: Number(rate),
  environment: await evaluate(
    `({ua:navigator.userAgent,width:innerWidth,height:innerHeight,cells:document.querySelectorAll('[data-course-cell]').length,gridWidth:document.querySelector('[data-schedule-grid]').clientWidth})`
  ),
  touch: [],
  sweep: [],
  control: [],
  preview: [],
}

/**
 * 装观测器：长任务、LoAF（Chrome 123+，能给出 styleAndLayoutDuration）、
 * 以及课程格内联 style 写入次数（fitCourseCells 每轮写 display / --cc-scale / width）。
 */
const installObservers = () =>
  evaluate(`(() => {
  window.__zoomPerf = window.__zoomPerf || {};
  if (window.__zoomObserved) return true;
  window.__zoomObserved = true;
  const observer = new PerformanceObserver(list => {
    const p = window.__zoomPerf;
    if (!p || !p.active) return;
    p.tasks.push(...list.getEntries().map(e => ({start:e.startTime,duration:e.duration})));
  });
  observer.observe({entryTypes:['longtask']});
  try {
    const loaf = new PerformanceObserver(list => {
      const p = window.__zoomPerf;
      if (!p || !p.active) return;
      p.loaf.push(...list.getEntries().map(e => ({
        start:e.startTime, duration:e.duration,
        styleAndLayout:e.styleAndLayoutDuration, blocking:e.blockingDuration,
        scripts:e.scripts.length,
      })));
    });
    loaf.observe({entryTypes:['long-animation-frame']});
  } catch {}
  const mutation = new MutationObserver(() => {
    const p = window.__zoomPerf;
    if (p && p.active) p.styleWrites++;
  });
  mutation.observe(document.querySelector('[data-schedule-grid]'), {subtree:true, attributes:true, attributeFilter:['style']});
  return true;
})()`)

/** 开始一段采样窗口：记录帧、长任务、段内课程格 style 写入。 */
const beginWindow = () =>
  evaluate(`(() => {
  window.__zoomPerf = {active:true, start:performance.now(), frames:[], tasks:[], loaf:[], styleWrites:0};
  const p = window.__zoomPerf;
  const tick = t => { if (window.__zoomPerf!==p) return; p.frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return true;
})()`)

const collectWindow = () =>
  evaluate(`(() => {
  const p = window.__zoomPerf; p.active = false;
  return {...p, zoomLevel: Number(document.querySelector('[data-schedule-grid]').dataset.zoomLevel),
          inlineZoom: document.querySelector('[data-schedule-grid]').style.getPropertyValue('--schedule-zoom'),
          scaled: [...document.querySelectorAll('[data-course-cell]')].filter(el => el.style.getPropertyValue('--cc-scale')).length,
          // 几何读数（P4 起）：容器内容盒会被滚动条征用，而课程格盒子不会 —— 几何键以课程格盒子为准
          // 的论证就靠这几行数值钉住（见 research/README.md §9）。
          geometry: (() => {
            const scroll = document.querySelector('[data-schedule-scroll]');
            const grid = document.querySelector('[data-schedule-grid]');
            const cell = scroll.querySelector('[data-course-cell]');
            return {
              containerClient: [scroll.clientWidth, scroll.clientHeight],
              containerOffset: [scroll.offsetWidth, scroll.offsetHeight],
              scrollbar: [scroll.offsetWidth - scroll.clientWidth, scroll.offsetHeight - scroll.clientHeight],
              grid: [grid.clientWidth, grid.clientHeight],
              cell: cell ? [cell.offsetWidth, cell.offsetHeight] : null,
              key: cell ? cell.dataset.courseKey : null,
              cells: document.querySelectorAll('[data-course-cell]').length,
              columns: getComputedStyle(grid).gridTemplateColumns,
            };
          })()};
})()`)

/** 把一段窗口读数压成可比指标。 */
const summarize = (window, from, to) => {
  const frames = window.frames.filter((t) => t >= from && t <= to)
  const gaps = frames.slice(1).map((t, index) => t - frames[index])
  const tasks = window.tasks.filter((task) => task.start + task.duration >= from && task.start <= to)
  const loaf = window.loaf.filter((entry) => entry.start + entry.duration >= from && entry.start <= to)
  const sorted = [...gaps].sort((a, b) => a - b)
  return {
    frames: frames.length,
    maxFrameGap: gaps.length ? Math.max(...gaps) : null,
    p95FrameGap: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    longTasks: tasks.map((task) => Math.round(task.duration * 10) / 10),
    worstLongTask: tasks.length ? Math.max(...tasks.map((task) => task.duration)) : 0,
    styleAndLayoutDuration: loaf.length ? Math.max(...loaf.map((entry) => entry.styleAndLayout)) : null,
    blockingDuration: loaf.length ? Math.max(...loaf.map((entry) => entry.blocking)) : null,
    loafCount: loaf.length,
    styleWrites: window.styleWrites,
  }
}

await installObservers()

// ── A. 真实双指捏合 ────────────────────────────────────────────────────────────
if (mode === 'touch' || mode === 'both') {
  // 空闲预热的窗口：默认 0（捏合紧接加载，预热来不及跑），设 PREWAIT_MS 可让它跑完 ——
  // 这正是真机上「打开 App 看一眼再捏」的时序，也是预热唯一有意义的时序。
  const prewait = Number(process.env.PREWAIT_MS ?? 0)
  if (prewait > 0) await sleep(prewait)

  // 交替「捏开 → 捏拢」，每轮都从已提交档位出发，避免依赖 reload 复位。
  const plans = [
    { name: 'pinch-out-1x→2x', from: 60, to: 132, expect: 2 },
    { name: 'pinch-in-2x→1x', from: 132, to: 59, expect: 1 },
    { name: 'pinch-out-1x→2x', from: 60, to: 132, expect: 2 },
    { name: 'pinch-in-2x→1x', from: 132, to: 59, expect: 1 },
  ]
  for (const plan of plans) {
    await evaluate(`(() => { const el=document.querySelector('[data-schedule-scroll]'); el.scrollTop=0; el.scrollLeft=0; return true })()`)
    await beginWindow()
    const centerX = 206
    const centerY = 400
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(centerX - plan.from / 2, centerY, 1), point(centerX + plan.from / 2, centerY, 2)],
    })
    const steps = 40
    for (let step = 1; step <= steps; step++) {
      const half = (plan.from + ((plan.to - plan.from) * step) / steps) / 2
      await send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [point(centerX - half, centerY, 1), point(centerX + half, centerY, 2)],
      })
      await sleep(16)
    }
    const beforeRelease = await evaluate('performance.now()')
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(800)
    const window = await collectWindow()
    const gesture = summarize(window, window.start, beforeRelease)
    const afterRelease = summarize(window, beforeRelease, beforeRelease + 600)
    const run = { plan: plan.name, expectTier: plan.expect, gesture, afterRelease, finalZoomLevel: window.zoomLevel, geometry: window.geometry }
    report.touch.push(run)
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ mode: 'touch', ...run }))
    assert.equal(window.zoomLevel, plan.expect, `${plan.name}: 松手后必须吸附到 ${plan.expect}x`)
  }
}

// ── B. 合成 rAF 扫档（1x→2x，60 帧 @真实 rAF 节奏）──────────────────────────────
if (mode === 'sweep' || mode === 'both') {
  // 先复位到 1x：用双击切换（DOUBLE_TAP 去抖窗口 400ms，所以两次点击要拉开间隔）。
  for (const direction of ['out', 'in']) {
    await evaluate(`(() => { const el=document.querySelector('[data-schedule-scroll]'); el.scrollTop=0; el.scrollLeft=0; return true })()`)
    await beginWindow()
    await evaluate(`(() => {
      const grid = document.querySelector('[data-schedule-grid]');
      const p = window.__zoomPerf;
      const start = performance.now();
      const duration = 1000;
      const from = ${direction === 'out' ? '1' : '2'};
      const to = ${direction === 'out' ? '2' : '1'};
      const tick = () => {
        if (!p.active) return;
        const k = Math.min(1, (performance.now() - start) / duration);
        grid.style.setProperty('--schedule-zoom', String(from + (to - from) * k));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()`)
    const start = await evaluate('performance.now()')
    await sleep(1400)
    const end = await evaluate('performance.now()')
    const window = await collectWindow()
    const run = { direction, span: direction === 'out' ? '1x→2x' : '2x→1x', from: start, to: end, window: summarize(window, start, end), geometry: window.geometry }
    // 复位到真实档位，供下一轮从一致的起点出发。
    await evaluate(`(() => { document.querySelector('[data-schedule-grid]').style.removeProperty('--schedule-zoom'); return true })()`)
    report.sweep.push(run)
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ mode: 'sweep', ...run }))
  }
}

// ── C. 控制组：离屏克隆网格（零 JS 测量）── 分离「浏览器自身换行」与「JS 反复强制布局」──
// 克隆节点没有任何 ResizeObserver / 测量任务，因此这一组测到的只有「宽度变化 → 引擎重排 + 绘制」
// 的裸代价；再叠加 blur 半径，量出模糊滤镜自身的开销。只读操作：克隆用完即删，不碰真实网格。
if (mode === 'control' || mode === 'both') {
  const blurRadii = (process.env.BLUR_RADII ?? '0,2,4').split(',').map((value) => Number(value))
  for (const radius of blurRadii) {
    const mounted = await evaluate(`(() => {
      document.getElementById('__zoomControlHost')?.remove();
      const scroll = document.querySelector('[data-schedule-scroll]');
      const source = document.querySelector('[data-schedule-grid]');
      const host = document.createElement('div');
      host.id = '__zoomControlHost';
      const width = scroll.clientWidth;
      host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;overflow:hidden;height:600px;width:' + width + 'px';
      const clone = source.cloneNode(true);
      clone.removeAttribute('data-schedule-grid');
      host.appendChild(clone);
      document.body.appendChild(host);
      return {width, cells: clone.querySelectorAll('[data-course-cell]').length};
    })()`)
    await evaluate(`(() => { const el=document.querySelector('[data-schedule-scroll]'); el.scrollTop=0; el.scrollLeft=0; return true })()`)
    await beginWindow()
    await evaluate(`(() => {
      const host = document.getElementById('__zoomControlHost');
      const grid = host.firstElementChild;
      const p = window.__zoomPerf;
      if (${radius} > 0) host.style.filter = 'blur(${radius}px)';
      const start = performance.now();
      const duration = 1000;
      const tick = () => {
        if (!p.active) return;
        const k = Math.min(1, (performance.now() - start) / duration);
        grid.style.setProperty('--schedule-zoom', String(1 + k));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()`)
    const start = await evaluate('performance.now()')
    await sleep(1400)
    const end = await evaluate('performance.now()')
    const window = await collectWindow()
    await evaluate(`(() => { document.getElementById('__zoomControlHost')?.remove(); return true })()`)
    const run = { blurRadius: radius, span: '1x→2x', mounted, window: summarize(window, start, end) }
    report.control.push(run)
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ mode: 'control', ...run }))
  }
}
// ── D. 预览路径：合成层 transform（零重排）── 量「手势期只做 scaleX + blur」能不能到 60fps ──
// 与 C 组同一个离屏克隆，但改的是 transform 而不是宽度：如果合成器路径能稳住 60fps，
// 就证明「手势期 transform 预览 + 松手一次性落定真实排布」这条设计成立。
if (mode === 'preview' || mode === 'both') {
  const blurRadii = (process.env.BLUR_RADII ?? '0,3').split(',').map((value) => Number(value))
  for (const radius of blurRadii) {
    const mounted = await evaluate(`(() => {
      document.getElementById('__zoomControlHost')?.remove();
      const scroll = document.querySelector('[data-schedule-scroll]');
      const source = document.querySelector('[data-schedule-grid]');
      const host = document.createElement('div');
      host.id = '__zoomControlHost';
      const width = scroll.clientWidth;
      host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;overflow:hidden;height:600px;width:' + width + 'px;transform-origin:0 0';
      const clone = source.cloneNode(true);
      clone.removeAttribute('data-schedule-grid');
      host.appendChild(clone);
      document.body.appendChild(host);
      return {width, cells: clone.querySelectorAll('[data-course-cell]').length};
    })()`)
    await beginWindow()
    await evaluate(`(() => {
      const host = document.getElementById('__zoomControlHost');
      const p = window.__zoomPerf;
      if (${radius} > 0) host.style.filter = 'blur(${radius}px)';
      const start = performance.now();
      const duration = 1000;
      const centerX = ${mounted.width} / 2;
      const tick = () => {
        if (!p.active) return;
        const k = Math.min(1, (performance.now() - start) / duration);
        const zoom = 1 + k;
        // 与真实实现同形：把捏合中心固定在原地（translate 与 scaleX 都是合成器属性）。
        host.style.transform = 'translateX(' + (centerX * (1 - zoom)).toFixed(2) + 'px) scaleX(' + zoom.toFixed(4) + ')';
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()`)
    const start = await evaluate('performance.now()')
    await sleep(1400)
    const end = await evaluate('performance.now()')
    const window = await collectWindow()
    await evaluate(`(() => { document.getElementById('__zoomControlHost')?.remove(); return true })()`)
    const run = { blurRadius: radius, span: '1x→2x', mounted, window: summarize(window, start, end) }
    report.preview.push(run)
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ mode: 'preview', ...run }))
  }
}

report.summary = {
  touchWorstFrameGap: Math.max(0, ...report.touch.map((run) => run.gesture.maxFrameGap ?? 0)),
  touchWorstLongTask: Math.max(0, ...report.touch.map((run) => run.gesture.worstLongTask)),
  touchStyleWrites: report.touch.reduce((sum, run) => sum + run.gesture.styleWrites, 0),
  sweepWorstFrameGap: Math.max(0, ...report.sweep.map((run) => run.window.maxFrameGap ?? 0)),
  sweepWorstLongTask: Math.max(0, ...report.sweep.map((run) => run.window.worstLongTask)),
  sweepStyleWrites: report.sweep.reduce((sum, run) => sum + run.window.styleWrites, 0),
  control: report.control.map((run) => ({
    blurRadius: run.blurRadius,
    maxFrameGap: run.window.maxFrameGap,
    worstLongTask: run.window.worstLongTask,
    frames: run.window.frames,
  })),
  preview: report.preview.map((run) => ({
    blurRadius: run.blurRadius,
    maxFrameGap: run.window.maxFrameGap,
    worstLongTask: run.window.worstLongTask,
    frames: run.window.frames,
  })),
}
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ environment: report.environment, summary: report.summary }, null, 2))
if (process.env.PROFILE === '1') {
  const { profile } = await send('Profiler.stop')
  writeFileSync(output + '.cpuprofile', JSON.stringify(profile))
}
await send('Emulation.setCPUThrottlingRate', { rate: 1 })
socket.close()
