import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import ImportDialog from '~/components/dialog/ImportDialog'
import { useClassStore } from '~/store'
import { useAttendanceStore } from '~/store/attendanceStore'
import { useScheduleDisplayStore } from '~/store/scheduleDisplayStore'
import AddMakeupDialog, { type MakeupTarget } from './AddMakeupDialog'
import DayQuickActionsDialog from './DayQuickActionsDialog'
import ScheduleEmptyState from './ScheduleEmptyState'
import ScheduleHeader from './ScheduleHeader'
import ScheduleTable from './ScheduleTable'
import ScheduleCourseDialog from './ScheduleCourseDialog'
import { buildCourseColorMap } from './courseColor'
import { buildMakeupClass, cellKey, getMakeupCourseOptions, getMakeupEndSection, planDayMakeup } from './makeupLesson'
import { deriveSectionTimes, getCurrentRealWeek, getDayDate, getMaxWeek, getVisibleCourses } from './utils'
import { useWeekAttendance } from './hooks/useWeekAttendance'
import { useWeekKeyboardNavigation } from './hooks/useWeekKeyboardNavigation'

export default function SchedulePage() {
  const {
    classes,
    classMarks,
    currentWeek,
    isInitialized,
    school,
    setShowImportDialog,
    toggleAttendance,
    setNote,
    setCurrentWeek,
    firstWeekStartDate,
    addClass,
    removeClass,
    addClasses,
    applyHoliday,
  } = useClassStore()

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [makeupTarget, setMakeupTarget] = useState<MakeupTarget | null>(null)
  const [makeupDayTarget, setMakeupDayTarget] = useState<number | null>(null)

  useEffect(() => {
    if (!isInitialized) {
      if (!school) {
        setShowImportDialog(true)
      }
    } else if (classes.length === 0) {
      setShowImportDialog(true)
    }
  }, [isInitialized, school, classes.length, setShowImportDialog])

  const showOutOfWeekCourses = useScheduleDisplayStore((state) => state.showOutOfWeekCourses)
  const visibleCourses = useMemo(
    () => getVisibleCourses(classes, currentWeek, showOutOfWeekCourses),
    [classes, currentWeek, showOutOfWeekCourses]
  )

  // 节次时间用整个学期的课程推导（不是仅本周），这样只在其他周出现的节次也能拿到时间。
  const sectionTimes = useMemo(() => deriveSectionTimes(classes), [classes])

  // 「课程号 → 配色档位」的稳定映射：用整学期课程构建，保证同一门课在任意周次都同色。
  const courseColorMap = useMemo(() => buildCourseColorMap(classes), [classes])

  // 补课可选的源课程（只能从现有课程里挑），整学期去重。
  const makeupCourseOptions = useMemo(() => getMakeupCourseOptions(classes), [classes])

  // 当前周已占用的格子集合：既用于「空格子才能补课」，也用于补课跨节时的截断（不与现有课程重叠）。
  const occupiedCells = useMemo(() => {
    const cells = new Set<string>()
    visibleCourses.forEach(({ course }) => {
      for (let section = course.startSection; section <= course.endSection; section += 1) {
        cells.add(cellKey(course.dayOfWeek, section))
      }
    })
    return cells
  }, [visibleCourses])

  const handleAddMakeup = useCallback(
    (option: (typeof makeupCourseOptions)[number]) => {
      if (!makeupTarget) return

      const endSection = getMakeupEndSection(occupiedCells, makeupTarget.dayOfWeek, makeupTarget.section, option.length)
      addClass(
        buildMakeupClass(option.source, {
          week: currentWeek,
          dayOfWeek: makeupTarget.dayOfWeek,
          startSection: makeupTarget.section,
          endSection,
          sectionTimes,
        })
      )
      setMakeupTarget(null)
      toast.success('已补一节课')
    },
    [addClass, currentWeek, makeupTarget, occupiedCells, sectionTimes]
  )

  const handleDeleteCourse = useCallback(
    (classId: string) => {
      removeClass(classId)
      setSelectedCourseId(null)
    },
    [removeClass]
  )

  const handleDayMakeup = useCallback(
    (sourceCourses: typeof classes) => {
      if (makeupDayTarget === null) return

      const { toCreate, skipped } = planDayMakeup({
        sourceCourses,
        targetDayOfWeek: makeupDayTarget,
        week: currentWeek,
        occupied: occupiedCells,
        sectionTimes,
      })

      addClasses(toCreate)
      setMakeupDayTarget(null)

      if (toCreate.length === 0) {
        toast.error('这一天的对应时段都已有课，没有可补的')
        return
      }
      toast.success(`已补 ${toCreate.length} 节课${skipped > 0 ? `，${skipped} 节因冲突跳过` : ''}`)
    },
    [addClasses, currentWeek, makeupDayTarget, occupiedCells, sectionTimes]
  )

  // 目标列头（周几）在当前周的全部课程：放假操作要把它们一次性标记为已上。
  const targetDayCourses = useMemo(
    () =>
      makeupDayTarget === null
        ? []
        : classes.filter((classItem) => classItem.dayOfWeek === makeupDayTarget && classItem.weeks.includes(currentWeek)),
    [classes, currentWeek, makeupDayTarget]
  )

  const handleDayHoliday = useCallback(
    (holidayName: string) => {
      if (makeupDayTarget === null) return

      const classIds = targetDayCourses.map((classItem) => classItem.id)
      if (classIds.length === 0) {
        toast.error('这一天没有课程')
        return
      }

      applyHoliday(classIds, currentWeek, holidayName)
      setMakeupDayTarget(null)
      toast.success(`已把 ${classIds.length} 节课标记为已上（${holidayName}）`)
    },
    [applyHoliday, currentWeek, makeupDayTarget, targetDayCourses]
  )

  const maxWeek = useMemo(() => getMaxWeek(classes), [classes])
  const currentRealWeek = useMemo(() => getCurrentRealWeek(classes, firstWeekStartDate), [classes, firstWeekStartDate])

  useWeekKeyboardNavigation({ currentWeek, maxWeek, onWeekChange: setCurrentWeek })

  const attendanceEnabled = useAttendanceStore((state) => state.enabled)
  const { markAllAsAttended, markAllAsUnattended } = useWeekAttendance()

  const selectedCourse = visibleCourses.find((entry) => entry.course.id === selectedCourseId)?.course || null
  const selectedMark = selectedCourse ? classMarks[`${selectedCourse.id}-${currentWeek}`] : undefined

  if (!isInitialized || !school || classes.length === 0) {
    return <ScheduleEmptyState school={school} hasClasses={classes.length > 0} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background px-2 pb-3 pt-3 md:px-5 md:py-6 md:pb-6">
      <ImportDialog />

      <div className="mx-auto flex min-h-0 w-full max-w-[1410px] flex-1 flex-col">
        <ScheduleHeader
          currentWeek={currentWeek}
          attendanceEnabled={attendanceEnabled}
          maxWeek={maxWeek}
          currentRealWeek={currentRealWeek}
          onWeekChange={setCurrentWeek}
          onMarkAllAsAttended={markAllAsAttended}
          onMarkAllAsUnattended={markAllAsUnattended}
        />
        <ScheduleTable
          visibleCourses={visibleCourses}
          classMarks={classMarks}
          courseColorMap={courseColorMap}
          attendanceEnabled={attendanceEnabled}
          currentWeek={currentWeek}
          firstWeekStartDate={firstWeekStartDate}
          sectionTimes={sectionTimes}
          maxWeek={maxWeek}
          onWeekChange={setCurrentWeek}
          onCourseClick={(course) => setSelectedCourseId(course.id)}
          onEmptyCellClick={(dayOfWeek, section) => setMakeupTarget({ dayOfWeek, section })}
          onDayHeaderClick={(dayOfWeek) => setMakeupDayTarget(dayOfWeek)}
        />
      </div>
      <AddMakeupDialog
        open={makeupTarget !== null}
        target={makeupTarget}
        currentWeek={currentWeek}
        options={makeupCourseOptions}
        onOpenChange={(open) => !open && setMakeupTarget(null)}
        onConfirm={handleAddMakeup}
      />
      <DayQuickActionsDialog
        open={makeupDayTarget !== null}
        targetDayOfWeek={makeupDayTarget}
        targetDate={makeupDayTarget !== null ? getDayDate(firstWeekStartDate, currentWeek, makeupDayTarget) : null}
        classes={classes}
        firstWeekStartDate={firstWeekStartDate}
        targetCourseCount={targetDayCourses.length}
        onOpenChange={(open) => !open && setMakeupDayTarget(null)}
        onConfirmMakeup={handleDayMakeup}
        onConfirmHoliday={handleDayHoliday}
      />
      <ScheduleCourseDialog
        key={`${selectedCourse?.id || 'none'}-${currentWeek}`}
        course={selectedCourse}
        currentWeek={currentWeek}
        mark={selectedMark}
        attendanceEnabled={attendanceEnabled}
        open={selectedCourse !== null}
        onOpenChange={(open) => !open && setSelectedCourseId(null)}
        onToggleAttendance={toggleAttendance}
        onSaveNote={setNote}
        onDelete={handleDeleteCourse}
      />
    </div>
  )
}
