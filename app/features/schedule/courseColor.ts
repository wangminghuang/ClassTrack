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

/** 旧版以课程号哈希分配颜色，保证同一门课始终使用同一色板档位。 */
function courseHash(courseId: string): number {
  let hash = 0
  for (let index = 0; index < courseId.length; index += 1) {
    hash = courseId.charCodeAt(index) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

/** 为整学期课程构建与旧版一致的 `courseId → 色板档位` 映射。 */
export function buildCourseColorMap(classes: Class[]): Map<string, number> {
  const colorMap = new Map<string, number>()
  classes.forEach(({ courseId }) => {
    if (!colorMap.has(courseId)) {
      colorMap.set(courseId, courseHash(courseId) % COURSE_COLOR_THEMES.length)
    }
  })
  return colorMap
}

/** 解析课程主题；非本周课使用同一哈希档位对应的淡化色。 */
export function resolveCourseTheme(courseId: string, colorMap: Map<string, number>, isOutOfWeek: boolean): CourseColorTheme {
  const index = colorMap.get(courseId) ?? courseHash(courseId) % COURSE_COLOR_THEMES.length
  return isOutOfWeek ? COURSE_OUT_OF_WEEK_THEMES[index] : COURSE_COLOR_THEMES[index]
}
