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
 * 合并同一格的内容、首帧、尺寸与字体通知；清理时移除待执行的旧闭包。
 * @param requestFrame 请求下一绘制帧（SSR 导入时不访问 window）。
 * @param cancelFrame 取消无待测格子的绘制帧。
 * @param fit 批量适配函数，测试可注入确定性的观测点。
 * @returns 可入队和撤销的课程格测量队列。
 */
export function createCellLayoutQueue(
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void,
  fit: (jobs: CellLayoutJob[]) => void = fitCourseCells
) {
  const pending = new Set<CellLayoutJob>()
  let frame: number | null = null
  return {
    enqueue(job: CellLayoutJob) {
      pending.add(job)
      if (frame !== null) return
      frame = requestFrame(() => {
        frame = null
        const jobs = [...pending]
        pending.clear()
        fit(jobs)
      })
    },
    remove(job: CellLayoutJob) {
      pending.delete(job)
      if (pending.size === 0 && frame !== null) {
        cancelFrame(frame)
        frame = null
      }
    },
  }
}

export const cellLayoutQueue = createCellLayoutQueue(
  (callback) => window.requestAnimationFrame(callback),
  (id) => window.cancelAnimationFrame(id)
)
