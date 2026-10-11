import { useLayoutEffect, useRef } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import type { Class, ClassMark } from '~/lib/types'
import { cn } from '~/lib/utils'
import { useScheduleDisplayStore } from '~/store/scheduleDisplayStore'
import { isAttendanceMarked } from '~/store/utils'
import { cellLayoutQueue } from './cellLayout'
import type { CellLayoutJob } from './cellLayout'
import { CELL_ABSENT_RING_CLASS, CELL_ATTENDED_RING_CLASS, CELL_BADGE_CLASS, CELL_FONT_CLASS, CELL_RING_CLASS } from './cellScale'
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

  // 内容变更才重建测量任务；配色/出勤角标/回调变化不影响文字盒子。
  useLayoutEffect(() => {
    const content = contentRef.current
    const button = buttonRef.current
    const block = blockRef.current
    if (!content || !button || !block) return

    const name = nameRef.current
    const room = roomRef.current
    const parity = parityRef.current
    const teacher = teacherRef.current
    const noteElement = noteRef.current
    const optional = [noteElement, teacher, parity]
    const job: CellLayoutJob = {
      prepare: () => {
        for (const el of optional) {
          if (el) el.style.display = ''
        }
        button.style.removeProperty('--cc-scale')
        block.style.width = ''
        // 标签仍由 CSS 决定桌面隐藏；教师/备注有空间时展开。
        for (const el of [teacher, noteElement]) {
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
        for (const el of [parity, name, room, teacher, noteElement]) {
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
    let cancelled = false
    const measure = () => {
      if (!cancelled) cellLayoutQueue.enqueue(job)
    }
    // 下一绘制帧统一适配所有格子，保留首次布局定稿后的纠偏。
    measure()
    if (document.fonts?.status === 'loading') void document.fonts.ready.then(measure)
    document.fonts?.addEventListener('loadingdone', measure)

    let lastWidth: number | undefined
    let lastHeight: number | undefined
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      measure()
    })
    observer.observe(button)
    return () => {
      cancelled = true
      cellLayoutQueue.remove(job)
      document.fonts?.removeEventListener('loadingdone', measure)
      observer.disconnect()
    }
  }, [course.name, course.classroom, course.teacher, parityLabel, note])

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
