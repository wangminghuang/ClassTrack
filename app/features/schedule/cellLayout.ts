import { recordFitSnapshot, resolveTierApply, setCacheGeometry } from './cellLayoutCache'
import type { CellFitSnapshot } from './cellLayoutCache'
import { CELL_FALLBACK_SCALES } from './cellScale'
import { ZOOM_MIN } from './constants'

/** DOM 读写分开，确保多个格子共享同一次布局，而不是逐格强制整张网格重排。 */
export type CellLayoutJob = {
  /**
   * 内容签名（课程号 + 课名 / 教室 / 教师 / 单双周 / 备注）。
   *
   * 它既是预计算缓存的键，也是实测结果回写入库的键。空串表示**不可缓存**（结构不完整的夹具、
   * 测试用的假作业）：这类作业永远走实测路径，也永远不入库。
   */
  contentKey: string
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
 * @param contentKey 内容签名（见 {@link CellLayoutJob.contentKey}）；空串表示这批格子不可缓存。
 * @returns 读写作业；缺少内容容器或文字块时返回 `null`（结构不对，宁可不测）。
 */
export function createCellLayoutJob(button: HTMLElement, contentKey: string): CellLayoutJob | null {
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
    contentKey,
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

/** 可整行丢弃的可选字段数量：备注 → 教师 → 单双周标签（与作业里的 `optional` 顺序一一对应）。 */
const OPTIONAL_ROW_COUNT = 3

/**
 * 当前已提交档位。
 *
 * 滑块式的「当前值」放在这里而不是缓存模块里：缓存保持纯函数（档位由调用方显式传入），
 * 而这里是所有「DOM 世界状态」的归口 —— 挂起标记、队列、当前档位都在同一个模块里，
 * 收尾时一眼能看完。
 */
let currentTier: number = ZOOM_MIN

/**
 * 声明已提交档位。
 *
 * 必须在**改宽度那一次提交里**调用（见 `useScheduleZoom` 的落定序列）：排布批次要等到本帧末
 * 的 `ResizeObserver` 回声才跑起来，而那时队列需要知道「这批格子属于哪个档位」才能命中缓存。
 *
 * @param tier 已提交档位（`ZOOM_TIERS` 之一）。
 */
export function setCellLayoutTier(tier: number): void {
  currentTier = tier
}

/**
 * 几何读取器：由 `ScheduleTable` 注册（只有它知道滚容器、列模板与断点，见 `geometryKeyOf`）。
 *
 * 之所以是「按需读」而不是「变化时推」：推送必然晚一帧 —— `ResizeObserver` 的回调在渲染步骤的
 * 最后才跑，而落定那一帧的排布批次恰好紧接着就要用这个键。实测口径是「四轮捏合里有三轮仍在
 * 实测」：键晚一帧 ⇒ 换档后第一批查询必然落空 ⇒ 刚量过的档位白量。按需读则总是读到当时 DOM
 * 的真实状态（读之前落定的宽度已经写下去了，布局连滚动条状态一起算）。
 */
let readGeometry: (() => string) | null = null

/**
 * 注册几何读取器。
 *
 * @param read 返回当前几何键（见 `geometryKeyOf`）。
 */
export function setCellLayoutGeometryReader(read: () => string): void {
  readGeometry = read
}

/**
 * 读一次当前几何键。
 *
 * @returns 几何键；未注册时返回空串（此时任何几何都算同一套，缓存退化为不做几何隔离）。
 */
export function currentCellLayoutGeometry(): string {
  return readGeometry?.() ?? ''
}

/** 一次「换作用域运行」的参数：档位与几何读取器一起换。 */
export type CellLayoutScope = {
  /** 这段运行里这批格子所属的档位。 */
  tier: number
  /** 这段运行里的几何读取器（预热要读克隆网格的盒子，而不是真实网格的）。 */
  readGeometry: () => string
}

/**
 * 在给定作用域里跑一段，跑完把档位与几何读取器都还原。
 *
 * 这是给空闲预热开的口子：预热量的是一份离屏克隆，它的档位与盒子都与真实网格不同，
 * 而 `fitCourseCells()` 是从这两个模块级来源取「这批格子属于哪一档、什么盒子」的。
 *
 * 用「临时换、跑完还原」而不是把档位/几何做成显式参数：真实路径的两个来源都是**当帧的 DOM 状态**
 * （`commit` 声明档位、`ScheduleTable` 注册读取器），把它们透传到底会把这条时序纪律拆散在多处；
 * 而换作用域只在同步调用的一瞬间生效，中间不可能插进真实批次（JS 单线程，且预热从不在帧回调里
 * 让出）。
 *
 * @param scope 这段运行的作用域。
 * @param run 要跑的逻辑（通常是 `fitCourseCells`）。
 * @returns `run` 的返回值。
 */
export function withCellLayoutScope<T>(scope: CellLayoutScope, run: () => T): T {
  const previousTier = currentTier
  const previousReader = readGeometry

  currentTier = scope.tier
  readGeometry = scope.readGeometry

  try {
    return run()
  } finally {
    currentTier = previousTier
    readGeometry = previousReader
  }
}

/**
 * 逐个读一遍格子，返回谓词为真的下标。
 *
 * 用它而不是 `jobs.filter()`，是为了让「读阶段」保持「一次读完、读之间不插写入」的形状 ——
 * 谓词里的读取（`overflows()` / `widthOverflows()`）一旦与写入交错，每格都会强制一次整表布局。
 *
 * @param jobs 这一批格子。
 * @param predicate 读判据，第二个参数是下标。
 * @returns 为真的下标，按传入顺序。
 */
function indicesWhere(jobs: readonly CellLayoutJob[], predicate: (job: CellLayoutJob, index: number) => boolean): number[] {
  const result: number[] = []

  jobs.forEach((job, index) => {
    if (predicate(job, index)) result.push(index)
  })

  return result
}

/**
 * 实测适配一批课程格，并把结果回读进预计算缓存。
 *
 * 既有适配规则：备注 → 教师 → 标签 → 字号兜底 → 文字块收窄。每个阶段先读完再写，下一阶段才
 * 触发布局；轮数不随课程格数量增长。收尾顺带把每格的最终写法（丢了几行 / 兜底到哪一档 /
 * 文字块多宽）记成快照 —— 这是缓存的第一填充来源，零额外成本，任何一次真实适配都会让它
 * 自己所在档位的条目变热。
 *
 * @param jobs 这批要走实测的课程格。
 * @param tier 这批格子所处的档位（快照按它入库）。
 */
function measureCourseCells(jobs: readonly CellLayoutJob[], tier: number): void {
  jobs.forEach((job) => job.prepare())

  const hidden = jobs.map(() => 0)
  const scales = jobs.map(() => 1)
  let overflowing = indicesWhere(jobs, (job) => job.overflows())

  for (let round = 0; round < OPTIONAL_ROW_COUNT && overflowing.length > 0; round += 1) {
    overflowing.forEach((index) => jobs[index].hideOptional(round))
    overflowing.forEach((index) => {
      hidden[index] = round + 1
    })
    overflowing = overflowing.filter((index) => jobs[index].overflows())
  }

  for (const scale of CELL_FALLBACK_SCALES) {
    if (overflowing.length === 0) break
    overflowing.forEach((index) => jobs[index].setScale(scale))
    overflowing.forEach((index) => {
      scales[index] = scale
    })
    overflowing = overflowing.filter((index) => jobs[index].overflows())
  }

  const widths = jobs.map((job) => Math.ceil(job.readUsedWidth()))
  jobs.forEach((job, index) => {
    if (widths[index] > 0) job.setWidth(widths[index])
  })

  const restore = indicesWhere(jobs, (job, index) => widths[index] > 0 && (job.overflows() || job.widthOverflows()))
  restore.forEach((index) => jobs[index].setWidth(0))

  const restored = new Set(restore)
  jobs.forEach((job, index) => {
    if (job.contentKey === '') return

    const width = widths[index] > 0 && !restored.has(index) ? widths[index] : 0
    recordFitSnapshot({ contentKey: job.contentKey, tier }, { hidden: hidden[index], scale: scales[index], width })
  })
}

/**
 * 批量适配一批课程格：命中预计算的纯写套用，没命中的回退到实测。
 *
 * 这是「零测量换档」的主路径。命中时**一次格子测量都不做**（套用路径只写 `display` /
 * `--cc-scale` / 文字块宽度）；只要有格子没命中，就只对它走实测 —— 宁可慢一次，
 * 也绝不显示一份没算过的排布（R7 的回退）。
 *
 * 批次开头读一次几何（见 `setCellLayoutGeometryReader`）：读一次就把整批的键定下来，
 * 既保证「套用」与「回写」用的是同一套几何，也不至于在套用路径里每格读一次、每格强制一次布局。
 * 这一次容器级读取是本函数唯一的非格子读取，且通常落在一帧里布局已经干净的时候（不额外强制布局）。
 *
 * @param jobs 本轮需要重新适配的课程格。
 */
export function fitCourseCells(jobs: CellLayoutJob[]): void {
  if (jobs.length === 0) return

  // 几何必须在这里现读：`ResizeObserver` 推送的版本要晚一帧，而落定后的第一批查询就在下一帧。
  // 读之前落定的宽度已经写下去了，布局（含滚动条状态）因此是这一档的真实几何。
  setCacheGeometry(currentCellLayoutGeometry())

  const plan = resolveTierApply(
    jobs.map((job) => ({
      contentKey: job.contentKey,
      apply: (snapshot: CellFitSnapshot) => applyCellSnapshot(job, snapshot),
    })),
    currentTier
  )

  if (plan.missing.length === 0) return

  measureCourseCells(
    plan.missing.map((index) => jobs[index]),
    currentTier
  )
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
