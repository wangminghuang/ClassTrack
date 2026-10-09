import { useLayoutEffect, useRef } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import type { Class, ClassMark } from '~/lib/types'
import { cn } from '~/lib/utils'
import { useScheduleDisplayStore } from '~/store/scheduleDisplayStore'
import { isAttendanceMarked } from '~/store/utils'
import {
  CELL_ABSENT_RING_CLASS,
  CELL_ATTENDED_RING_CLASS,
  CELL_BADGE_CLASS,
  CELL_FALLBACK_SCALES,
  CELL_FONT_CLASS,
  CELL_RING_CLASS,
} from './cellScale'
import type { CourseColorTheme } from './courseColor'
import { getWeekParityLabel } from './utils'

type ScheduleCourseCellProps = {
  course: Class
  mark: ClassMark | undefined
  /** 这门课的目标配色主题，由上层按 `courseId` 稳定解析后传入。 */
  theme: CourseColorTheme
  /**
   * 「出勤统计」是否开启（个人中心的开关）。
   *
   * 关闭时这一格不出现任何已上/未上痕迹（打勾 / 警示角标、缺勤红描边与 title 文案），
   * **但备注照常显示** —— 备注与出勤共用同一条 `ClassMark`，却是两件事。
   */
  attendanceEnabled: boolean
  /** 非本周课程（开启「淡化显示非本周课程」时才会出现在格子里）。 */
  isOutOfWeek: boolean
  onClick: () => void
}

export default function ScheduleCourseCell({ course, mark, theme, attendanceEnabled, isOutOfWeek, onClick }: ScheduleCourseCellProps) {
  const showAttendanceStatus = useScheduleDisplayStore((state) => state.showAttendanceStatus)
  /**
   * 这一格是否**做过出勤判断** —— 判据只用 `isAttendanceMarked()`（`app/store/utils.ts`）：
   * 看板 `isAbsentSession()` 用的是同一条，课表不得另写一份 `mark?.attendanceMarked !== false`（会漂移）。
   * 「只写了备注」的标记 `attendanceMarked === false`，不算判断。
   */
  const attendanceMarked = isAttendanceMarked(mark)
  const isAttended = attendanceMarked && !!mark?.isAttended
  /** 缺勤 = 做过判断且判的是「未上」；未标记 / 只写备注的格子两种都不是。 */
  const isAbsent = attendanceMarked && !isAttended
  const note = mark?.note || ''
  const parityLabel = isOutOfWeek ? '非本周' : getWeekParityLabel(course.weeks)
  // 出勤痕迹要同时满足「出勤统计已开启」与「用户在课表显示里没关掉它」，且只针对本周课：
  // 非本周课一般没有当周标记，灰色态优先，不再叠加任何出勤痕迹。
  const showAttendance = attendanceEnabled && showAttendanceStatus && !isOutOfWeek
  /**
   * 是否显露这一格的出勤痕迹（角标 + title 文案）。
   *
   * 只有**做过出勤判断**的格子才露：未标记 / 只写备注的格子既不变淡、也没有角标与文案 ——
   * 「还没标记」不等于「缺勤」，课表不该替用户下这个结论。
   */
  const showAttendanceMarks = showAttendance && attendanceMarked
  /** 缺勤红描边 / 已上绿描边：受同样的两层开关与「非本周优先」约束（非本周走灰色态，不叠出勤痕迹）。 */
  const showAbsentRing = showAttendance && isAbsent
  const showAttendedRing = showAttendance && isAttended

  const buttonRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const blockRef = useRef<HTMLSpanElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)
  const roomRef = useRef<HTMLSpanElement>(null)
  const parityRef = useRef<HTMLSpanElement>(null)
  const teacherRef = useRef<HTMLSpanElement>(null)
  const noteRef = useRef<HTMLSpanElement>(null)

  /**
   * 按格子实际可用高度决定可选行显示到哪一级。
   *
   * **字号不在这里决定**。改动前本函数还负责「把课名与教室的字号按 px 硬减两档」，
   * 那是「同屏有的格子正常、有的缩水」的根源：档位判据是视口布尔值（`isMobile`）而不是
   * 格子尺寸，而且它把行高从 1.2 改成 1.05，放大了落差。现在字号完全由 `cellScale.ts`
   * 的容器单位公式算出来（同尺寸必然同字号），本函数只做两件事：
   *
   * 1. **整行丢弃**弹性行，按 **备注 → 教师 → 单双周** 的顺序（丢完仍放不下则进入第 2 步）；
   * 2. **兜底缩放**：按相对比例逐档乘 `--cc-scale`（不再按 px 硬减）。
   *
   * 课名与教室是硬要求：任何尺寸下都不丢弃，只参与兜底缩放。缩到 8px 下限仍放不下时
   * 停手，接受已确认的已知限制（1 节矮格 + 超长课名，见 `mobile-schedule-layout.md`），
   * 但**绝不水平溢出**。
   *
   * 直接写 `style` 而不是 setState：测量与渲染不会互相触发，也不会每格多渲染一次。
   */
  useLayoutEffect(() => {
    const content = contentRef.current
    const button = buttonRef.current
    if (!content || !button) return

    /** 溢出量（px）；容差 1px 吸收亚像素误差。 */
    const overflow = () => content.scrollHeight - content.clientHeight

    const apply = () => {
      const name = nameRef.current
      const room = roomRef.current
      const block = blockRef.current
      const parity = parityRef.current
      const teacher = teacherRef.current
      const note = noteRef.current

      // 每轮都从基准状态重新测量：先清掉上一轮的内联覆盖，让 class 上的断点规则与
      // 容器单位重新生效。`--cc-scale` 也必须清掉，否则上一轮的兜底会粘住。
      for (const el of [parity, teacher, note]) {
        if (el) el.style.display = ''
      }
      button.style.removeProperty('--cc-scale')
      if (block) block.style.width = ''

      // 教师与备注在 class 上是 `hidden`（无 JS 时保持保守态），由这里在有空间时打开；
      // 单双周不参与这一步：它的可见性由 CSS 断点决定（`block md:hidden`，桌面端为 none），
      // JS 只在空间不够时关掉它。这样判据里不再需要任何视口布尔值。
      for (const el of [teacher, note]) {
        if (el) el.style.display = 'block'
      }

      // 优先级从低到高逐个丢弃：备注 → 教师 → 单双周。
      // 用 `display: 'none'` 而不是清空内联值：单双周的自然态是 `block`（手机端），
      // 清空内联值无法把它藏起来。
      for (const el of [note, teacher, parity]) {
        if (!el) continue
        if (overflow() <= 1) break
        el.style.display = 'none'
      }

      // 兜底：按相对比例缩小字号（所有字号行同步缩，保持行间层级）。
      // 下限写在 CSS 侧 `clamp()` 的第一位，所以缩到底也不会突破可读下限。
      for (const scale of CELL_FALLBACK_SCALES) {
        if (overflow() <= 1) break
        button.style.setProperty('--cc-scale', String(scale))
      }

      // 内层块收窄到「实际用到的最大行宽」：手机端由外层 `items-center` 居中，桌面端
      // （`md:items-start`）靠左对齐。逐行 `text-center` 会把每行都居中、长课名更难读，所以统一走块内左对齐。
      if (!block) return
      let used = 0
      for (const el of [parity, name, room, teacher, note]) {
        if (!el || el.style.display === 'none' || getComputedStyle(el).display === 'none') continue
        const range = document.createRange()
        range.selectNodeContents(el)
        for (const rect of range.getClientRects()) {
          if (rect.height > 1) used = Math.max(used, rect.width)
        }
      }
      if (used <= 0) return
      // **必须夹在容器内**：`overflow-wrap: break-word` 不降低 min-content，像 `(Python)`
      // 这种不可断 token 的 min-content 可能比内边距盒还宽，块被撑出卡片后只能压到描边上。
      block.style.width = `min(${Math.ceil(used)}px, 100%)`
      // 宽度或高度任一不满足就退回整宽——宁可偏左，也绝不溢出。
      if (overflow() > 1 || block.scrollWidth > block.clientWidth + 1) block.style.width = ''
    }

    let cancelled = false
    const measure = () => {
      if (!cancelled) apply()
    }

    apply()

    // 首帧测完还不够可靠：挂载那一刻网格行高常常还没被 1fr 分配定稿（量到的是内容自然高，
    // 于是误判「放得下」），中文字体也可能晚到改变换行；两者都不会触发按钮尺寸变化，
    // 只靠 ResizeObserver 会一直用错误的结论。所以补两拍：下一帧、以及字体就绪后各重测一次。
    const raf = requestAnimationFrame(measure)
    void document.fonts?.ready.then(measure)

    // 格子尺寸由网格与缩放决定（内容改动不会改变外层按钮尺寸），因此观察按钮即可在
    // 缩放、旋屏、窗口尺寸变化后重新测量。
    const observer = new ResizeObserver(measure)
    observer.observe(button)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  })

  return (
    <button
      ref={buttonRef}
      type="button"
      data-course-cell
      {...(isOutOfWeek ? { 'data-course-out-of-week': '' } : {})}
      className={cn(
        'group relative flex h-full min-h-0 w-full cursor-pointer flex-col overflow-hidden text-left focus-visible:z-10 focus-visible:outline-none',
        // 尺度全部由课程格容器的尺寸推导（见 cellScale.ts）：内边距、圆角、描边都不再是固定 px。
        '[padding:var(--cc-pad-y)_var(--cc-pad-x)] [border-radius:var(--cc-radius)]',
        // 描边：已上=绿、缺勤=红，其余恢复半透明白（见 cellScale.ts）。
        showAbsentRing ? CELL_ABSENT_RING_CLASS : showAttendedRing ? CELL_ATTENDED_RING_CLASS : CELL_RING_CLASS,
        theme.surface
      )}
      onClick={onClick}
      title={`${course.name}${showAttendanceMarks ? `，${isAttended ? '已上' : '未上'}` : ''}${isOutOfWeek ? '，非本周' : ''}，点击查看详情`}
    >
      {/* 内容**顶部对齐**（不是垂直居中）：1 行内容的格子和 7 行内容的格子都从同一条顶边起排，
          否则短内容浮在卡片中间、长内容贴着顶部，同一屏里每格的起始高度都不一样。
          溢出时内容向下溢出并被 `overflow-hidden` 裁掉，顶部始终可见 —— 这正好与 PRD 里
          已确认的已知限制（极端格子允许纵向裁剪）一致。 */}
      <span ref={contentRef} className="flex min-h-0 flex-1 flex-col items-center justify-start md:items-start">
        <span ref={blockRef} className="block text-left">
          <span ref={nameRef} data-course-name className={cn('block break-words font-semibold text-white', CELL_FONT_CLASS.name)}>
            {course.name}
          </span>
          {parityLabel && (
            // 自然态即在手机端可见（不再是 `hidden` + JS 打开）：可见性完全交给 CSS 断点，
            // JS 只负责空间不够时把它关掉，判据里因此不再需要视口布尔值。
            <span ref={parityRef} data-course-parity className={cn('block text-white/70 md:hidden', CELL_FONT_CLASS.room)}>
              {parityLabel}
            </span>
          )}
          {course.classroom && (
            <span ref={roomRef} data-course-room className={cn('mt-0.5 block break-words text-white/85', CELL_FONT_CLASS.room)}>
              {course.classroom}
            </span>
          )}
          {course.teacher && (
            <span ref={teacherRef} data-course-teacher className={cn('hidden break-all text-white/80', CELL_FONT_CLASS.room)}>
              {course.teacher}
            </span>
          )}
          <span ref={noteRef} data-course-note className={cn('hidden break-all text-white/70 md:truncate', CELL_FONT_CLASS.room)}>
            {note || (
              <span className="hidden text-white/60 transition-opacity md:inline md:opacity-0 md:group-hover:opacity-100">
                点击查看详情
              </span>
            )}
          </span>
        </span>
      </span>
      {showAttendanceMarks && (
        <span className={cn('absolute bottom-1 right-1', isAttended ? 'text-emerald-600' : 'text-rose-600')}>
          {isAttended ? <CheckCircle2 className={CELL_BADGE_CLASS} /> : <CircleAlert className={CELL_BADGE_CLASS} />}
        </span>
      )}
    </button>
  )
}
