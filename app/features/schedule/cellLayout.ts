import type { CellFitSnapshot } from './cellLayoutCache'
import { CELL_FALLBACK_SCALES } from './cellScale'

/** DOM 读写分开，确保多个格子共享同一次布局，而不是逐格强制整张网格重排。 */
export type CellLayoutJob = {
  prepare: () => void
  overflows: () => boolean
  hideOptional: (index: number) => void
  setScale: (scale: number) => void
  readUsedWidth: () => number
  setWidth: (width: number) => void
  widthOverflows: () => boolean
}

/**
 * 从一个课程格按钮上构造测量作业。
 *
 * 作业原本内联在 `ScheduleCourseCell` 的 `useLayoutEffect` 里，抽出来是为了让
 * 「真实格子」和「离屏预热克隆」共用同一份测量规则：两条路径一旦各写一份，缓存里
 * 的数字就不再等于真实格子能排出来的结果。
 *
 * 元素靠 data 属性定位（`data-course-content` / `data-course-block` / `data-course-*`），
 * 因此克隆只需要照抄 HTML 结构，不需要在 React 侧再传一遍 ref。
 *
 * @param button 课程格按钮（真实格子或离屏克隆里的同构节点）。
 * @returns 读写作业；缺少内容容器或文字块时返回 `null`（结构不对，宁可不测）。
 */
export function createCellLayoutJob(button: HTMLElement): CellLayoutJob | null {
  const content = button.querySelector<HTMLElement>('[data-course-content]')
  const block = button.querySelector<HTMLElement>('[data-course-block]')
  if (!content || !block) return null

  const name = button.querySelector<HTMLElement>('[data-course-name]')
  const room = button.querySelector<HTMLElement>('[data-course-room]')
  const parity = button.querySelector<HTMLElement>('[data-course-parity]')
  const teacher = button.querySelector<HTMLElement>('[data-course-teacher]')
  const note = button.querySelector<HTMLElement>('[data-course-note]')
  const optional = [note, teacher, parity]

  return {
    prepare: () => {
      for (const el of optional) {
        if (el) el.style.display = ''
      }
      button.style.removeProperty('--cc-scale')
      block.style.width = ''
      // 标签仍由 CSS 决定桌面隐藏；教师/备注有空间时展开。
      for (const el of [teacher, note]) {
        if (el) el.style.display = 'block'
      }
    },
    overflows: () => content.scrollHeight > content.clientHeight + 1,
    hideOptional: (index) => {
      const el = optional[index]
      if (el) el.style.display = 'none'
    },
    setScale: (scale) => button.style.setProperty('--cc-scale', String(scale)),
    readUsedWidth: () => {
      let used = 0
      for (const el of [parity, name, room, teacher, note]) {
        if (!el || el.style.display === 'none' || getComputedStyle(el).display === 'none') continue
        const range = document.createRange()
        range.selectNodeContents(el)
        for (const rect of range.getClientRects()) {
          if (rect.height > 1) used = Math.max(used, rect.width)
        }
      }
      return used
    },
    // 必须夹在容器内：(Python) 等 token 不降低 min-content。
    setWidth: (width) => {
      block.style.width = width > 0 ? `min(${width}px, 100%)` : ''
    },
    widthOverflows: () => block.scrollWidth > block.clientWidth + 1,
  }
}

/**
 * 把一份预计算快照套用到一个课程格上 —— **纯写路径，不读任何 DOM**。
 *
 * 与 `fitCourseCells()` 的关系是「同一套写法的重放」：那里也是先 `prepare()` 清掉上一轮的
 * 内联覆盖，再按顺序 `hideOptional(index)`、`setScale(scale)`、`setWidth(width)`；这里只是
 * 把「丢弃几行、缩到哪一档、文字块多宽」换成已经算好的数字，因此不需要任何测量，
 * 也就不会产生 `overflows()` 那种强制布局。
 *
 * 两处刻意的取舍（保持与实测路径的 DOM 终态逐项一致）：
 *
 * - **`snapshot.scale === 1` 时不写 `--cc-scale`**：实测路径只在真的走兜底时才调 `setScale`，
 *   没走兜底就没有这个内联值。写成 `1` 虽然渲染等价，但会让「有没有走兜底」从 DOM 上分不出来。
 * - **`snapshot.width === 0` 时仍调一次 `setWidth(0)`**：实测路径的收尾也会对退回整宽的格子
 *   调一次 `setWidth(0)`，两者都落到 `style.width = ''`，没有差别；保持调用形态一致便于比对。
 *
 * @param job 目标课程格的读写作业（`prepare` / `hideOptional` / `setScale` / `setWidth` 都是写）。
 * @param snapshot 来自 `cellLayoutCache` 的预计算快照。
 */
export function applyCellSnapshot(job: CellLayoutJob, snapshot: CellFitSnapshot): void {
  job.prepare()

  for (let index = 0; index < snapshot.hidden; index += 1) job.hideOptional(index)

  if (snapshot.scale !== 1) job.setScale(snapshot.scale)

  job.setWidth(snapshot.width)
}

/**
 * 批量执行既有适配规则：备注 → 教师 → 标签 → 字号兜底 → 文字块收窄。
 * 每个阶段先读完再写，下一阶段才触发布局；轮数不随课程格数量增长。
 * @param jobs 本轮需要重新适配的课程格。
 */
export function fitCourseCells(jobs: CellLayoutJob[]): void {
  jobs.forEach((job) => job.prepare())
  let overflowing = jobs.filter((job) => job.overflows())
  for (let index = 0; index < 3 && overflowing.length > 0; index += 1) {
    overflowing.forEach((job) => job.hideOptional(index))
    overflowing = overflowing.filter((job) => job.overflows())
  }
  for (const scale of CELL_FALLBACK_SCALES) {
    if (overflowing.length === 0) break
    overflowing.forEach((job) => job.setScale(scale))
    overflowing = overflowing.filter((job) => job.overflows())
  }
  const widths = jobs.map((job) => Math.ceil(job.readUsedWidth()))
  jobs.forEach((job, index) => {
    if (widths[index] > 0) job.setWidth(widths[index])
  })
  const restore = jobs.filter((job, index) => widths[index] > 0 && (job.overflows() || job.widthOverflows()))
  restore.forEach((job) => job.setWidth(0))
}

/**
 * 测量冻结标记：为真时 `cellLayoutQueue` 只攒作业、不排帧。
 *
 * 双指缩放的前半程整段冻结测量 —— 手势期每帧改列宽会让每个课程格的 `ResizeObserver`
 * 触发一次，进而每帧都读一遍 `scrollHeight`（强制布局）。冻结期把这一串动作推迟到
 * 落定那一刻一次性完成，手势帧里因此只剩样式写入。
 */
let suspended = false

/**
 * 合并同一格的内容、首帧、尺寸与字体通知；清理时移除待执行的旧闭包。
 *
 * @param requestFrame 请求下一绘制帧（SSR 导入时不访问 window）。
 * @param cancelFrame 取消无待测格子的绘制帧。
 * @param fit 批量适配函数，测试可注入确定性的观测点。
 * @param isSuspended 询问当前是否处于冻结期，测试可注入。
 * @returns 可入队、撤销并在恢复后补刷的课程格测量队列。
 */
export function createCellLayoutQueue(
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void,
  fit: (jobs: CellLayoutJob[]) => void = fitCourseCells,
  isSuspended: () => boolean = () => suspended
) {
  const pending = new Set<CellLayoutJob>()
  let frame: number | null = null
  const schedule = () => {
    if (frame !== null) return
    frame = requestFrame(() => {
      frame = null
      // 冻结期在帧回调里也要挡住：入队时还没挂起、回调执行时已经挂起的那种边界。
      // 此时不清 `pending`，这些作业留给 `flush()` 在恢复后补刷。
      if (isSuspended()) return
      const jobs = [...pending]
      pending.clear()
      fit(jobs)
    })
  }
  return {
    enqueue(job: CellLayoutJob) {
      pending.add(job)
      if (isSuspended()) return
      schedule()
    },
    remove(job: CellLayoutJob) {
      pending.delete(job)
      if (pending.size === 0 && frame !== null) {
        cancelFrame(frame)
        frame = null
      }
    },
    /** 把挂起期间攒下的格子排进下一帧；已有待执行帧或没有作业时什么都不做。 */
    flush() {
      if (pending.size === 0) return
      schedule()
    },
  }
}

export const cellLayoutQueue = createCellLayoutQueue(
  (callback) => window.requestAnimationFrame(callback),
  (id) => window.cancelAnimationFrame(id)
)

/**
 * 冻结课程格测量：此后入队的格子只攒不刷，直到 {@link resumeCellLayout}。
 *
 * 成对调用由 `useScheduleZoom` 负责（手势进入预览时冻结、落定时恢复）。冻结期内的作业
 * 不会丢：恢复时会连带把攒下的格子一起排进下一帧，所以「预览期间内容变了」也能补上。
 */
export function suspendCellLayout(): void {
  suspended = true
}

/**
 * 恢复课程格测量，并把冻结期间攒下的格子一次性排进下一帧。
 *
 * 恢复与补刷绑在一个入口里，避免出现「恢复了测量但忘了补刷」这种只丢一次适配、
 * 事后极难发现的组合。
 */
export function resumeCellLayout(): void {
  suspended = false
  cellLayoutQueue.flush()
}
