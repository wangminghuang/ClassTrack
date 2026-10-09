import { addDays } from 'date-fns'
import type { Class } from '~/lib/types'
import { DETAIL_FULL_THRESHOLD, DETAIL_STANDARD_THRESHOLD, ZOOM_MAX, ZOOM_MIN, ZOOM_TIERS } from './constants'

/**
 * 计算指定教学周和星期对应的自然日期。
 *
 * 项目约定 `firstWeekStartDate` 是第一周第一天，`dayOfWeek` 使用
 * 周一为 1、周日为 7 的编号。函数会基于这两个约定计算偏移天数，
 * 用于课表表头展示 `MM.dd` 日期。
 *
 * @param firstWeekStartDate 第一周第一天的 ISO 日期字符串；为空时无法计算日期。
 * @param currentWeek 当前展示的教学周，从 1 开始。
 * @param dayOfWeek 当前周内的星期编号，范围通常为 1-7。
 * @returns 对应的日期对象；缺少或无法解析起始日期时返回 `null`。
 */
export function getDayDate(firstWeekStartDate: string | null, currentWeek: number, dayOfWeek: number) {
  if (!firstWeekStartDate) return null

  try {
    const baseDate = new Date(firstWeekStartDate)
    const daysOffset = (currentWeek - 1) * 7 + (dayOfWeek - 1)
    return addDays(baseDate, daysOffset)
  } catch {
    return null
  }
}

/**
 * 获取当前课程数据中出现过的最大教学周。
 *
 * 课程数据中的 `weeks` 表示该课程在哪些周上课。课表翻页、当前周限制
 * 和统计范围都需要知道最大的周次。没有课程或课程周次数组为空时，
 * 使用 20 周作为常见学期长度兜底。
 *
 * @param classes 已导入的课程列表。
 * @returns 课程中出现的最大周次，最小兜底值为 20。
 */
export function getMaxWeek(classes: Class[]) {
  return classes.reduce((max, classItem) => {
    const classMaxWeek = Math.max(...classItem.weeks)
    return Math.max(max, classMaxWeek)
  }, 20)
}

/**
 * 根据课程数据和学期起始日期计算“返回本周”应跳转到的周次。
 *
 * 课程表页面右上角的“返回本周”按钮依赖这个结果；导入完成后也应该跳转到
 * 同一周次，因此把最大周次计算和当前教学周计算封装在这里，保证按钮点击
 * 与导入后的自动跳转使用完全一致的逻辑。
 *
 * @param classes 已导入的课程列表，用于确定当前课表允许展示的最大周次。
 * @param firstWeekStartDate 第一周第一天的 ISO 日期字符串；为空时沿用 `getCurrentWeek` 的兜底逻辑。
 * @returns 应跳转到的现实当前教学周。
 */
export function getCurrentRealWeek(classes: Class[], firstWeekStartDate: string | null) {
  return getCurrentWeek(firstWeekStartDate, getMaxWeek(classes))
}

/**
 * 根据第一周第一天计算今天所在的教学周。
 *
 * 当用户设置了学期开始日期后，应用可以自动推算现实中的当前周次。
 * 返回值会被限制在 `1` 到 `maxWeek` 之间，避免学期开始前或学期结束后
 * 产生超出课表范围的周次。
 *
 * @param firstWeekStartDate 第一周第一天的 ISO 日期字符串；为空时返回第 1 周。
 * @param maxWeek 当前课程数据允许展示的最大周次。
 * @returns 推算出的当前教学周。
 */
export function getCurrentWeek(firstWeekStartDate: string | null, maxWeek: number) {
  if (!firstWeekStartDate) return 1

  try {
    const baseDate = new Date(firstWeekStartDate)
    const today = new Date()
    const diffTime = today.getTime() - baseDate.getTime()
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    const week = Math.floor(diffDays / 7) + 1
    return Math.min(Math.max(week, 1), maxWeek)
  } catch {
    return 1
  }
}

/** 课表渲染用的视图模型：在原课程上叠加“是否非本周”的淡化标记。 */
export type VisibleCourse = {
  course: Class
  isOutOfWeek: boolean
}

/**
 * 计算某个教学周课表上要渲染的课程列表。
 *
 * `showOutOfWeek` 关闭时行为与旧版完全一致：只返回本周有课的课程。
 * 开启时追加非本周课程（`isOutOfWeek=true`，保持输入顺序排在本周课之后），
 * 并在函数内完成冲突消解：
 * 1. 本周课优先，非本周课任一占用格（`day-section`）与本周课重叠即丢弃；
 * 2. 非本周课之间互相重叠时保留先出现者；被丢弃课程的占用格同样视为已占用，
 *    保证结果只取决于输入 `classes` 的顺序（稳定顺序）。
 *
 * @param classes 整个学期的课程列表。
 * @param currentWeek 当前展示的教学周。
 * @param showOutOfWeek 是否淡化显示非本周课程。
 * @returns 可直接渲染的视图模型列表。
 */
export function getVisibleCourses(classes: Class[], currentWeek: number, showOutOfWeek: boolean): VisibleCourse[] {
  const inWeek: VisibleCourse[] = []
  const outOfWeek: VisibleCourse[] = []

  classes.forEach((course) => {
    if (course.weeks.includes(currentWeek)) {
      inWeek.push({ course, isOutOfWeek: false })
    } else {
      outOfWeek.push({ course, isOutOfWeek: true })
    }
  })

  if (!showOutOfWeek) return inWeek

  const occupiedCells = new Set<string>()
  const occupy = (course: Class) => {
    for (let section = course.startSection; section <= course.endSection; section += 1) {
      occupiedCells.add(`${course.dayOfWeek}-${section}`)
    }
  }
  const overlaps = (course: Class) => {
    for (let section = course.startSection; section <= course.endSection; section += 1) {
      if (occupiedCells.has(`${course.dayOfWeek}-${section}`)) return true
    }
    return false
  }

  inWeek.forEach(({ course }) => occupy(course))

  const visible: VisibleCourse[] = [...inWeek]
  outOfWeek.forEach((entry) => {
    const keep = !overlaps(entry.course)
    occupy(entry.course)
    if (keep) visible.push(entry)
  })

  return visible
}

/**
 * 单个节次可推导出的边界时间。
 *
 * 解析数据只有块级时间（一门课可能跨多节，例如 1-2 节 08:00-09:40），
 * 因此 `start` 表示“该节次正好是某门课的第一节时的上课时间”，
 * `end` 表示“该节次正好是某门课最后一节时的下课时间”。
 * 两个字段都可能缺失。
 */
export type SectionTime = {
  start?: string
  end?: string
}

/** 手机端课表的信息分级，由当前缩放档位推导。 */
export type ScheduleDetailLevel = 'compact' | 'standard' | 'full'

/**
 * 从课程数据推导每个节次的边界时间。
 *
 * 解析器只提供块级时间（`KSSJ`/`JSSJ` 对应一段节次），没有“每节各自几点到几点”
 * 的作息表，因此这里只能按下列规则还原：单节课程（`startSection === endSection`）
 * 同时贡献该节的 start 与 end；跨节课程只在第一节贡献 start、最后一节贡献 end。
 * 这样第 1 节会显示 08:00、第 2 节显示 09:40，而节中空档（08:45/08:55）无法还原。
 *
 * 同一节次出现多个候选时间时取出现次数最多者；票数相同时取字典序最小者，
 * 保证结果与课程数据顺序无关、多次调用一致。
 *
 * @param classes 整个学期的课程列表（不是仅本周的课程），这样只在其他周出现的节次也能拿到时间。
 * @returns 以节次编号为键的边界时间；无法推导的节次不会出现在结果中。
 */
export function deriveSectionTimes(classes: Class[]): Record<number, SectionTime> {
  const startVotes = new Map<number, Map<string, number>>()
  const endVotes = new Map<number, Map<string, number>>()

  const vote = (votes: Map<number, Map<string, number>>, section: number, time: string) => {
    if (!time) return

    const byTime = votes.get(section) ?? new Map<string, number>()
    byTime.set(time, (byTime.get(time) ?? 0) + 1)
    votes.set(section, byTime)
  }

  classes.forEach((classItem) => {
    vote(startVotes, classItem.startSection, classItem.startTime)
    vote(endVotes, classItem.endSection, classItem.endTime)
  })

  const pickTime = (byTime: Map<string, number> | undefined) => {
    if (!byTime) return undefined

    let winner: string | undefined
    let bestCount = -1

    byTime.forEach((count, time) => {
      const isBetter = count > bestCount
      const isStableTie = count === bestCount && winner !== undefined && time < winner
      if (isBetter || isStableTie) {
        winner = time
        bestCount = count
      }
    })

    return winner
  }

  const sectionTimes: Record<number, SectionTime> = {}
  const sectionNumbers = new Set([...startVotes.keys(), ...endVotes.keys()])

  sectionNumbers.forEach((section) => {
    const start = pickTime(startVotes.get(section))
    const end = pickTime(endVotes.get(section))
    if (!start && !end) return

    sectionTimes[section] = { ...(start ? { start } : {}), ...(end ? { end } : {}) }
  })

  return sectionTimes
}

/**
 * 判断课程周次是否可以用“单周 / 双周”概括。
 *
 * 只有全部周次同奇偶时才返回文案：全奇数返回 `单周`，全偶数返回 `双周`，
 * 混合周次或空数组返回空串（此时课程块不显示该徽标）。
 *
 * @param weeks 课程的上课周次数组。
 * @returns `单周`、`双周` 或空串。
 */
export function getWeekParityLabel(weeks: number[]): string {
  if (weeks.length === 0) return ''

  const isAllOdd = weeks.every((week) => week % 2 === 1)
  const isAllEven = weeks.every((week) => week % 2 === 0)
  if (isAllOdd) return '单周'
  if (isAllEven) return '双周'

  return ''
}

/**
 * 把任意缩放值裁剪到合法区间。
 *
 * 下界必须精确等于 1：网格的最小宽度按 `100% * 缩放值` 计算，只有等于 1 时
 * 才恰好铺满容器而不产生横向滚动。
 *
 * @param value 待裁剪的缩放值，可能来自双指手势的连续计算结果。
 * @returns 落在 `[ZOOM_MIN, ZOOM_MAX]` 内的缩放值；`NaN` 视为下界。
 */
export function clampZoom(value: number): number {
  if (Number.isNaN(value)) return ZOOM_MIN

  return Math.min(Math.max(value, ZOOM_MIN), ZOOM_MAX)
}

/**
 * 把连续缩放值吸附到最近的档位。
 *
 * 双指捏合过程中产生的是连续值，松手后必须落到 `ZOOM_TIERS` 之一，
 * 信息分级才有确定的触发点；正好处于两档中间时取较小的一档。
 *
 * @param value 松手时的连续缩放值。
 * @returns `ZOOM_TIERS` 中距离最近的一项。
 */
export function snapZoomTier(value: number): number {
  const clamped = clampZoom(value)
  const tiers: readonly number[] = ZOOM_TIERS

  return tiers.reduce((nearest, tier) => (Math.abs(tier - clamped) < Math.abs(nearest - clamped) ? tier : nearest), ZOOM_MIN)
}

/**
 * 根据缩放值判断课程块的信息分级。
 *
 * `compact` 只显示课名与单双周徽标，`standard` 追加教室，`full` 追加教师与备注。
 *
 * @param zoom 当前缩放值。
 * @returns 对应的信息分级。
 */
export function getDetailLevel(zoom: number): ScheduleDetailLevel {
  if (zoom >= DETAIL_FULL_THRESHOLD) return 'full'
  if (zoom >= DETAIL_STANDARD_THRESHOLD) return 'standard'

  return 'compact'
}
