import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Class, ClassMark } from '~/lib/types'
import ScheduleCourseCell from './ScheduleCourseCell'
import { CELL_ABSENT_RING_CLASS, CELL_ATTENDED_RING_CLASS, CELL_SOFT_RING_CLASS } from './cellScale'
import { COURSE_COLOR_THEMES } from './courseColor'

type ScheduleCourseCellProps = Parameters<typeof ScheduleCourseCell>[0]

const course: Class = {
  id: 'class-1',
  name: '高等数学',
  teacher: '张老师',
  classroom: 'A101',
  startTime: '08:00',
  endTime: '09:40',
  dayOfWeek: 1,
  startSection: 1,
  endSection: 2,
  weeks: [3],
  semester: '2025-2026-1',
  courseId: 'MATH',
  classId: '班级1',
  courseType: '必修',
  courseCategory: '专业课',
}

const attendedMark: ClassMark = { classId: 'class-1', week: 3, isAttended: true, note: '', attendanceMarked: true }
const absentMark: ClassMark = { classId: 'class-1', week: 3, isAttended: false, note: '请假', attendanceMarked: true }
const notedMark: ClassMark = { classId: 'class-1', week: 3, isAttended: false, note: '带实验报告', attendanceMarked: false }

function render(overrides: Partial<ScheduleCourseCellProps> = {}) {
  return renderToStaticMarkup(
    createElement(ScheduleCourseCell, {
      course,
      mark: attendedMark,
      theme: COURSE_COLOR_THEMES[0],
      attendanceEnabled: true,
      isOutOfWeek: false,
      onClick: () => {},
      ...overrides,
    })
  )
}

/** 缺勤玫红描边里的颜色（`#fda4af` = `rgb(253 164 175)`，rose-300）——出现它就说明用的是 `CELL_ABSENT_RING_CLASS`。 */
const ABSENT_RING_COLOR = 'rgb(253_164_175'
/** 已上绿描边里的颜色（`#6ee7b7` = `rgb(110 231 183)`，emerald-300）。 */
const ATTENDED_RING_COLOR = 'rgb(110_231_183'
/** 已上打勾 / 缺勤警示两个 lucide 图标的类名。 */
const CHECK_ICON = 'lucide-circle-check'
const ALERT_ICON = 'lucide-circle-alert'
/** 旧的「未上淡化」两段类名：口径收窄后任何格子都不该再出现。 */
const DIM_CLASSES = ['opacity-60', 'saturate-50']

function badgeCount(html: string) {
  return html.match(/\[width:var\(--cc-badge\)\]/g)?.length ?? 0
}

/** 断言这一格**没有任何**出勤痕迹：不变淡、无红/绿描边、无角标、文案不提已上 / 未上。 */
function expectNoAttendanceTrace(html: string) {
  for (const cls of DIM_CLASSES) expect(html).not.toContain(cls)
  expect(html).not.toContain(ABSENT_RING_COLOR)
  expect(html).not.toContain(ATTENDED_RING_COLOR)
  expect(html).not.toContain(CHECK_ICON)
  expect(html).not.toContain(ALERT_ICON)
  expect(badgeCount(html)).toBe(0)
  expect(html).not.toContain('已上')
  expect(html).not.toContain('未上')
}

describe('课程格的出勤外观', () => {
  it('缺勤：不变淡，改为实色红描边，并保留警示角标', () => {
    const html = render({ mark: absentMark, attendanceEnabled: true })

    for (const cls of DIM_CLASSES) expect(html).not.toContain(cls)
    expect(html).toContain(CELL_ABSENT_RING_CLASS)
    expect(html).not.toContain(CELL_ATTENDED_RING_CLASS)
    expect(html).not.toContain(CELL_SOFT_RING_CLASS)
    expect(html).toContain(ALERT_ICON)
    expect(html).not.toContain(CHECK_ICON)
    expect(badgeCount(html)).toBe(1)
    expect(html).toContain('未上')
  })

  it('已上：改为实色绿描边，保留打勾角标，不变淡也不加红描边', () => {
    const html = render({ mark: attendedMark, attendanceEnabled: true })

    for (const cls of DIM_CLASSES) expect(html).not.toContain(cls)
    expect(html).toContain(CELL_ATTENDED_RING_CLASS)
    expect(html).not.toContain(CELL_ABSENT_RING_CLASS)
    expect(html).not.toContain(CELL_SOFT_RING_CLASS)
    expect(html).toContain(CHECK_ICON)
    expect(badgeCount(html)).toBe(1)
    expect(html).toContain('已上')
  })

  it('未标记：完全中性 —— 不变淡、无角标、文案不提已上 / 未上', () => {
    expectNoAttendanceTrace(render({ mark: undefined, attendanceEnabled: true }))
  })

  it('只写了备注：与未标记一样中性，但备注照旧显示（备注与出勤解耦）', () => {
    const html = render({ mark: notedMark, attendanceEnabled: true })

    expectNoAttendanceTrace(html)
    expect(html).toContain('带实验报告')
  })

  it('关闭出勤统计时：缺勤 / 已上 / 未标记都不出现任何出勤痕迹', () => {
    for (const mark of [absentMark, attendedMark, notedMark, undefined]) {
      expectNoAttendanceTrace(render({ mark, attendanceEnabled: false }))
    }
  })

  it('关闭出勤统计时备注照旧显示（备注与出勤解耦）', () => {
    expect(render({ mark: notedMark, attendanceEnabled: false })).toContain('带实验报告')
  })

  it('非本周课使用课程对应的淡化色，不叠加出勤痕迹（即使标记为未上）', () => {
    const html = render({ mark: absentMark, attendanceEnabled: true, isOutOfWeek: true })

    expect(html).toContain('data-course-out-of-week')
    expect(html).toContain('非本周')
    expectNoAttendanceTrace(html)
  })
})

describe('课程格的尺度与视觉锚点', () => {
  it('教室元素带 data-course-room 锚点（验收脚本要靠它断言不溢出 / 不被丢弃）', () => {
    expect(render()).toContain('data-course-room')
  })

  it('字号与行高走 --cc-* 容器变量，不再有与格子尺寸无关的 px 字号', () => {
    const html = render()

    expect(html).toContain('var(--cc-name-raw)')
    expect(html).toContain('var(--cc-name-lh)')
    expect(html).toContain('var(--cc-room-raw)')
    expect(html).toContain('var(--cc-room-lh)')
    // 兜底缩放必须在使用处相乘（写在网格声明里会被固化掉），钳位也必须在使用处
    expect(html).toContain('var(--cc-scale,1)')
    expect(html).toMatch(/font-size:clamp\(8px,/)
    // 改动前这里是 text-[10px] / text-[9px] + md:text-sm / md:text-xs 两套硬编码值
    expect(html).not.toMatch(/text-\[\d+px\]/)
    expect(html).not.toContain('md:text-sm')
    expect(html).not.toContain('md:text-xs')
  })

  it('内边距 / 圆角 / 描边 / 角标同样由容器尺度推导', () => {
    const html = render()

    expect(html).toContain('[padding:var(--cc-pad-y)_var(--cc-pad-x)]')
    expect(html).toContain('[border-radius:var(--cc-radius)]')
    expect(html).toContain('var(--cc-ring)')
    expect(html).toContain('[width:var(--cc-badge)]')
    // 改动前固定 ring-2 / rounded-md md:rounded-lg / size-3 md:size-4
    expect(html).not.toContain('ring-2')
    expect(html).not.toContain('md:rounded-lg')
    expect(html).not.toContain('md:size-4')
  })

  it('单双周徽标的可见性交给 CSS 断点，不再由视口布尔值决定', () => {
    const html = render()

    expect(html).toContain('data-course-parity')
    expect(html).toContain('md:hidden')
    expect(html).toContain('单周')
  })

  it('出勤角标存在时带容器尺度的尺寸类', () => {
    const html = render({ mark: attendedMark, attendanceEnabled: true })
    const badgeMatches = html.match(/\[width:var\(--cc-badge\)\]/g) ?? []

    expect(badgeMatches.length).toBe(1)
    expect(html.match(/\[height:var\(--cc-badge\)\]/g)?.length).toBe(1)
  })
})
