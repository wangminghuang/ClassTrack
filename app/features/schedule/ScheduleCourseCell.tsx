import { useLayoutEffect, useRef } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import type { Class, ClassMark } from '~/lib/types'
import { cn } from '~/lib/utils'
import { useScheduleDisplayStore } from '~/store/scheduleDisplayStore'
import { isAttendanceMarked } from '~/store/utils'
import { cellLayoutQueue, createCellLayoutJob } from './cellLayout'
import { courseContentKey } from './cellLayoutCache'
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

  /**
   * 内容签名：既是这一格的测量作业在预计算缓存里的键，也是 `data-course-key` 的取值
   * （浏览器验收脚本按它逐格比对排布）。内容一改签名就变，旧条目永远不会被读到，
   * 所以缓存侧不需要任何显式失效逻辑（见 `cellLayoutCache.ts` 模块头）。
   */
  const contentKey = courseContentKey({
    id: course.id,
    name: course.name,
    classroom: course.classroom,
    teacher: course.teacher,
    parity: parityLabel,
    note,
    // 节次跨度也在签名里：改了上课节次，文字一个字没变，盒子高度却变了。
    span: `${course.startSection}-${course.endSection}`,
  })
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

  // 内容变更才重建测量任务；配色/出勤角标/回调变化不影响文字盒子。
  useLayoutEffect(() => {
    const button = buttonRef.current
    if (!button) return

    const job = createCellLayoutJob(button, contentKey)
    if (!job) return
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
  }, [contentKey])

  return (
    <button
      ref={buttonRef}
      type="button"
      data-course-cell
      data-course-key={contentKey}
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
      <span data-course-content className="flex min-h-0 flex-1 flex-col items-center justify-start md:items-start">
        <span data-course-block className="block text-left">
          <span data-course-name className={cn('block break-words font-semibold text-white', CELL_FONT_CLASS.name)}>
            {course.name}
          </span>
          {parityLabel && (
            // 自然态即在手机端可见（不再是 `hidden` + JS 打开）：可见性完全交给 CSS 断点，
            // JS 只负责空间不够时把它关掉，判据里因此不再需要视口布尔值。
            <span data-course-parity className={cn('block text-white/70 md:hidden', CELL_FONT_CLASS.room)}>
              {parityLabel}
            </span>
          )}
          {course.classroom && (
            <span data-course-room className={cn('mt-0.5 block break-words text-white/85', CELL_FONT_CLASS.room)}>
              {course.classroom}
            </span>
          )}
          {course.teacher && (
            <span data-course-teacher className={cn('hidden break-all text-white/80', CELL_FONT_CLASS.room)}>
              {course.teacher}
            </span>
          )}
          <span data-course-note className={cn('hidden break-all text-white/70 md:truncate', CELL_FONT_CLASS.room)}>
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
