import { describe, expect, it } from 'vitest'
import type { Class } from '~/lib/types'
import { buildCourseColorMap, COURSE_COLOR_THEMES, COURSE_OUT_OF_WEEK_THEMES, COURSE_PALETTES, resolveCourseTheme } from './courseColor'

function makeClass(courseId: string, id = courseId, weeks = [1, 2]): Class {
  return {
    id,
    name: `课程 ${courseId}`,
    teacher: '老师',
    classroom: '教室',
    startTime: '08:00',
    endTime: '09:40',
    dayOfWeek: 1,
    startSection: 1,
    endSection: 2,
    weeks,
    semester: '2026-2027-1',
    courseId,
    classId: id,
    courseType: '必修',
    courseCategory: '专业课',
  }
}

describe('课程颜色分配回退', () => {
  it('旧哈希碰撞的两个不同课程号在本周和非本周都使用不同颜色', () => {
    const classes = [makeClass('1001'), makeClass('1009')]
    const colorMap = buildCourseColorMap(classes)

    for (const isOutOfWeek of [false, true]) {
      expect(resolveCourseTheme('1001', colorMap, isOutOfWeek).surface).not.toBe(resolveCourseTheme('1009', colorMap, isOutOfWeek).surface)
    }
  })

  it('整学期八门不同课程各用一色，不受节次、周次、输入顺序和重复记录影响', () => {
    const classes = Array.from({ length: 8 }, (_, index) => makeClass(String(1001 + index * 8)))
    const colorMap = buildCourseColorMap(classes)
    const shuffledWithRepeats = [makeClass('1001', 'another-session', [3, 4]), ...[...classes].reverse()]
    const rebuiltMap = buildCourseColorMap(shuffledWithRepeats)

    expect(colorMap.size).toBe(8)
    expect(rebuiltMap).toEqual(colorMap)
    expect(new Set(classes.map(({ courseId }) => resolveCourseTheme(courseId, colorMap, false).surface)).size).toBe(8)
  })

  it('第九门课程依照历史规则循环复用第一档', () => {
    const classes = Array.from({ length: 9 }, (_, index) => makeClass(String(1001 + index * 8)))
    const colorMap = buildCourseColorMap(classes)

    expect(resolveCourseTheme('1065', colorMap, false)).toEqual(resolveCourseTheme('1001', colorMap, false))
  })

  it('非本周课程使用本课相同档位的淡化色', () => {
    const colorMap = buildCourseColorMap([makeClass('1009'), makeClass('1001')])

    expect(resolveCourseTheme('1009', colorMap, false)).toEqual(COURSE_COLOR_THEMES[1])
    expect(resolveCourseTheme('1009', colorMap, true)).toEqual(COURSE_OUT_OF_WEEK_THEMES[1])
  })

  it('空课表返回空映射，未收录课程按历史兜底使用第一档', () => {
    const colorMap = buildCourseColorMap([])

    expect(colorMap.size).toBe(0)
    expect(resolveCourseTheme('1002', colorMap, false)).toEqual(COURSE_COLOR_THEMES[0])
    expect(resolveCourseTheme('1002', colorMap, true)).toEqual(COURSE_OUT_OF_WEEK_THEMES[0])
  })
})

describe('两套课表配色', () => {
  it('新配色只调整紫蓝和浅粉两个档位，保留其余六种原色及淡化色', () => {
    const { original, adjusted } = COURSE_PALETTES

    expect(original.themes).toEqual(COURSE_COLOR_THEMES)
    expect(original.outOfWeekThemes).toEqual(COURSE_OUT_OF_WEEK_THEMES)
    expect(adjusted.themes).toHaveLength(8)
    expect(adjusted.outOfWeekThemes).toHaveLength(8)
    expect(adjusted.themes.flatMap((theme, index) => (theme.surface === original.themes[index].surface ? [] : [index]))).toEqual([2, 5])
    expect(
      adjusted.outOfWeekThemes.flatMap((theme, index) => (theme.surface === original.outOfWeekThemes[index].surface ? [] : [index]))
    ).toEqual([2, 5])
    expect(adjusted.themes[2].surface).toBe('bg-[#a7cc8a]')
    expect(adjusted.themes[5].surface).toBe('bg-[#e9a8d2]')
    expect(adjusted.outOfWeekThemes[2].surface).toBe('bg-[#bbc7b1]')
    expect(adjusted.outOfWeekThemes[5].surface).toBe('bg-[#e3d0dc]')
  })

  it('切换配色只改变主题，课程档位和非本周对应关系保持一致', () => {
    const classes = Array.from({ length: 8 }, (_, index) => makeClass(String(1001 + index * 8)))
    const colorMap = buildCourseColorMap(classes)
    const snapshot = Array.from(colorMap)

    for (const paletteId of ['original', 'adjusted'] as const) {
      const themes = classes.map(({ courseId }) => resolveCourseTheme(courseId, colorMap, false, paletteId))
      expect(new Set(themes.map((theme) => theme.surface)).size).toBe(8)
      classes.forEach(({ courseId }, index) => {
        expect(resolveCourseTheme(courseId, colorMap, true, paletteId)).toEqual(COURSE_PALETTES[paletteId].outOfWeekThemes[index])
      })
    }

    expect(Array.from(colorMap)).toEqual(snapshot)
  })
})
