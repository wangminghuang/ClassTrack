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
