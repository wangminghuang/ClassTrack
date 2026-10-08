import type { Class } from '~/lib/types'

/** 课程卡片主题。文字层级遵循课表规范，始终使用白色。 */
export type CourseColorTheme = {
  surface: string
}

/** 课表目标色板：平色填充、白字，与参考图逐色采样值一致。 */
export const COURSE_COLOR_THEMES: CourseColorTheme[] = [
  { surface: 'bg-[#87e5d4]' },
  { surface: 'bg-[#7bb7ef]' },
  { surface: 'bg-[#84aef7]' },
  { surface: 'bg-[#bcaaf5]' },
  { surface: 'bg-[#ee7c9b]' },
  { surface: 'bg-[#e7a0b3]' },
  { surface: 'bg-[#e98d78]' },
  { surface: 'bg-[#eab776]' },
]

/** 与主色板同序的非本周淡化色，文字仍保持白色。 */
export const COURSE_OUT_OF_WEEK_THEMES: CourseColorTheme[] = [
  { surface: 'bg-[#b8d6d1]' },
  { surface: 'bg-[#b3c7d9]' },
  { surface: 'bg-[#bdcae0]' },
  { surface: 'bg-[#dbd6eb]' },
  { surface: 'bg-[#d8b4be]' },
  { surface: 'bg-[#dfcad0]' },
  { surface: 'bg-[#d4b6af]' },
  { surface: 'bg-[#d4c3ae]' },
]

/**
 * 恢复 `718812f` 的课程号去重排序、顺序分配规则。
 *
 * 同一门课在任意周次和节次都使用同一档位；整学期不超过 8 门时每门课颜色不同，
 * 超过 8 门时循环复用。哈希取模会让少量不同课程也重色，不能用于该映射。
 *
 * @param classes 整个学期的课程列表。
 * @returns `courseId → 色板档位` 的稳定映射。
 */
export function buildCourseColorMap(classes: Class[]): Map<string, number> {
  const courseIds = Array.from(new Set(classes.map((classItem) => classItem.courseId))).sort((left, right) => left.localeCompare(right))

  const colorMap = new Map<string, number>()
  courseIds.forEach((courseId, index) => {
    colorMap.set(courseId, index % COURSE_COLOR_THEMES.length)
  })

  return colorMap
}

/** 解析课程主题；非本周课使用本课相同档位的淡化色，缺失映射沿用历史第一档兜底。 */
export function resolveCourseTheme(courseId: string, colorMap: Map<string, number>, isOutOfWeek: boolean): CourseColorTheme {
  const index = colorMap.get(courseId) ?? 0
  return isOutOfWeek ? COURSE_OUT_OF_WEEK_THEMES[index] : COURSE_COLOR_THEMES[index]
}
