import type { Class } from '~/lib/types'
import { getCourseKey } from '~/store/utils'
import type { SectionTime } from './utils'

/**
 * 补课可选的「源课程」。
 *
 * 补课只能从**现有课程**里选（用户诉求），所以这里把整学期课程按课程身份去重：
 * 同一门课（同 `getCourseKey`）只给一个选项，并记下它原本的节次长度，用来决定补课默认占几节。
 */
export type MakeupCourseOption = {
  /** 去重键（= `getCourseKey`），也作为列表项的 React key。 */
  key: string
  /** 作为模板的源课程（补课会克隆它的名称/教师/教室/课程号等）。 */
  source: Class
  /** 源课程原本的节次长度（endSection - startSection + 1），决定补课默认跨几节。 */
  length: number
}

/** 单元格占用键：`${dayOfWeek}-${section}`，与 `ScheduleTable` 的 `occupiedCells` 同构。 */
export function cellKey(dayOfWeek: number, section: number) {
  return `${dayOfWeek}-${section}`
}

/**
 * 把整学期课程去重成「可选源课程」列表。
 *
 * 按 `getCourseKey`（课程号-名称-教师）去重，取每组第一条作为模板，按课程名排序，方便在选择框里查找。
 *
 * @param classes 整学期课程（含已手动补课的）。
 * @returns 去重后的可选源课程，按课程名升序。
 */
export function getMakeupCourseOptions(classes: Class[]): MakeupCourseOption[] {
  const byKey = new Map<string, MakeupCourseOption>()

  for (const source of classes) {
    const key = getCourseKey(source)
    if (byKey.has(key)) continue
    byKey.set(key, {
      key,
      source,
      length: Math.max(1, source.endSection - source.startSection + 1),
    })
  }

  return Array.from(byKey.values()).sort((left, right) => left.source.name.localeCompare(right.source.name, 'zh-Hans-CN'))
}

/**
 * 计算补课从 `startSection` 起、最多 `desiredLength` 节时实际能占到的结束节次。
 *
 * 跟随源课程的节次长度，但遇到**已被占用的格子**或**超出第 12 节**就截断——补课绝不与现有课程重叠。
 *
 * @param occupied 当前周已占用单元格集合（键用 `cellKey`）。
 * @param dayOfWeek 目标星期。
 * @param startSection 起始节次（点击的空格子）。
 * @param desiredLength 期望占用的节数（通常为源课程长度）。
 * @param maxSection 课表最大节次，默认 12。
 * @returns 实际结束节次（≥ startSection）。
 */
export function getMakeupEndSection(
  occupied: ReadonlySet<string>,
  dayOfWeek: number,
  startSection: number,
  desiredLength: number,
  maxSection = 12
): number {
  let end = startSection
  for (let next = startSection + 1; next < startSection + desiredLength && next <= maxSection; next += 1) {
    if (occupied.has(cellKey(dayOfWeek, next))) break
    end = next
  }
  return end
}

/** 生成手动补课的唯一 id，避免与导入课程的 id 冲突。 */
export function createManualClassId() {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 基于源课程构建一节「补课」`Class`。
 *
 * 补课与普通课程完全同构：复制源课程的名称/教师/教室/课程号等（因此颜色、看板统计、课程管理都自然归到同一门课），
 * 只把它放到目标 周次/星期/节次，并按目标节次重算上下课时间（源课的时间对应的是它自己的节次，不能照搬）。
 *
 * @param source 作为模板的源课程。
 * @param placement 目标位置与可推导的节次时间。
 * @returns 可直接 `addClass` 的补课对象（带 `isManual: true`）。
 */
export function buildMakeupClass(
  source: Class,
  placement: {
    week: number
    dayOfWeek: number
    startSection: number
    endSection: number
    sectionTimes: Record<number, SectionTime>
  }
): Class {
  const { week, dayOfWeek, startSection, endSection, sectionTimes } = placement

  return {
    ...source,
    id: createManualClassId(),
    dayOfWeek,
    startSection,
    endSection,
    startTime: sectionTimes[startSection]?.start ?? '',
    endTime: sectionTimes[endSection]?.end ?? '',
    weeks: [week],
    isManual: true,
  }
}

/** 把 JS 的 `getDay()`（周日=0）换成课表口径（周一=1、周日=7）。 */
function toClassDayOfWeek(date: Date) {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

/** 把 `YYYY-MM-DD` 或可解析日期解析成本地零点；无法解析返回 null。 */
function parseLocalDate(value: string): Date | null {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  date.setHours(0, 0, 0, 0)
  return date
}

/**
 * 根据开学第一天推算某个自然日期落在第几教学周。
 *
 * @returns 教学周（从 1 开始）；缺少开学日期或日期早于开学则返回 null。
 */
export function getTeachingWeek(firstWeekStartDate: string | null, date: Date): number | null {
  const start = firstWeekStartDate ? parseLocalDate(firstWeekStartDate) : null
  if (!start) return null

  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((target.getTime() - start.getTime()) / 86_400_000)
  if (diffDays < 0) return null

  return Math.floor(diffDays / 7) + 1
}

/**
 * 取某个自然日期当天上的全部课程。
 *
 * 用于「按日期补课」：先把日期换算成教学周 + 星期，再筛出那天实际有的课。
 *
 * @param classes 整学期课程。
 * @param firstWeekStartDate 开学第一天 ISO 日期；为空时无法换算，返回空。
 * @param date 源日期。
 * @returns 当天的课程（按起始节次排序）。
 */
export function getCoursesOnDate(classes: Class[], firstWeekStartDate: string | null, date: Date): Class[] {
  const week = getTeachingWeek(firstWeekStartDate, date)
  if (week == null) return []

  const weekday = toClassDayOfWeek(date)
  return classes
    .filter((classItem) => classItem.dayOfWeek === weekday && classItem.weeks.includes(week))
    .sort((left, right) => left.startSection - right.startSection)
}

/**
 * 规划「把一批源课程补到目标星期」要新建哪些补课。
 *
 * 保持每门课原本的节次不变，只改到目标 星期/周次；与目标日已占用的格子（含同批已排入的）**冲突则跳过**，
 * 绝不重叠。纯函数，便于测试。
 *
 * @returns `toCreate` 为可直接 `addClasses` 的补课；`skipped` 为因冲突被跳过的门数。
 */
export function planDayMakeup(input: {
  sourceCourses: Class[]
  targetDayOfWeek: number
  week: number
  occupied: ReadonlySet<string>
  sectionTimes: Record<number, SectionTime>
}): { toCreate: Class[]; skipped: number } {
  const { sourceCourses, targetDayOfWeek, week, occupied, sectionTimes } = input
  const working = new Set(occupied)
  const toCreate: Class[] = []
  let skipped = 0

  for (const source of sourceCourses) {
    let hasConflict = false
    for (let section = source.startSection; section <= source.endSection; section += 1) {
      if (working.has(cellKey(targetDayOfWeek, section))) {
        hasConflict = true
        break
      }
    }

    if (hasConflict) {
      skipped += 1
      continue
    }

    toCreate.push(
      buildMakeupClass(source, {
        week,
        dayOfWeek: targetDayOfWeek,
        startSection: source.startSection,
        endSection: source.endSection,
        sectionTimes,
      })
    )
    for (let section = source.startSection; section <= source.endSection; section += 1) {
      working.add(cellKey(targetDayOfWeek, section))
    }
  }

  return { toCreate, skipped }
}
