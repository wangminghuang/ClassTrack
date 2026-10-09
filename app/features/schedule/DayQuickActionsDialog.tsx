import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Check, PartyPopper } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { DatePicker } from '~/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import type { Class } from '~/lib/types'
import { cn } from '~/lib/utils'
import { dayNames } from './constants'
import { getCoursesOnDate } from './makeupLesson'

type DayQuickActionsDialogProps = {
  open: boolean
  /** 目标星期（当前周的这一天）；为空时不渲染内容。 */
  targetDayOfWeek: number | null
  /** 目标星期在当前周对应的自然日期，用于标题展示；可能为空（未设开学日期）。 */
  targetDate: Date | null
  classes: Class[]
  firstWeekStartDate: string | null
  /** 当前周这一天的课程数：用于「今天放假」的可用性与提示。 */
  targetCourseCount: number
  onOpenChange: (open: boolean) => void
  /** 补课：把选中的「源课程」整批补到目标星期。 */
  onConfirmMakeup: (sourceCourses: Class[]) => void
  /** 放假：把当天课程全部置为已上并写上节日名称。 */
  onConfirmHoliday: (holidayName: string) => void
}

/**
 * 列头（周几）唤起的「当天快捷操作」弹窗，含两块：
 * - 补课操作：选一个源日期，把那天的课勾选后补到目标星期；
 * - 放假操作：输入节日名称，一键把当天课程全部标记为已上并写入备注。
 */
export default function DayQuickActionsDialog(props: DayQuickActionsDialogProps) {
  const { open, targetDayOfWeek, onOpenChange } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-hidden rounded-lg p-4 md:max-w-md md:p-6">
        {targetDayOfWeek !== null && <DayQuickActionsBody key={targetDayOfWeek} {...props} targetDayOfWeek={targetDayOfWeek} />}
      </DialogContent>
    </Dialog>
  )
}

function DayQuickActionsBody({
  targetDayOfWeek,
  targetDate,
  classes,
  firstWeekStartDate,
  targetCourseCount,
  onOpenChange,
  onConfirmMakeup,
  onConfirmHoliday,
}: DayQuickActionsDialogProps & { targetDayOfWeek: number }) {
  const [sourceDate, setSourceDate] = useState<Date | undefined>(undefined)
  // 取消勾选的课程 id；默认全选，所以这里存「被排除的」更省事。
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [holidayName, setHolidayName] = useState('')

  const sourceCourses = useMemo(
    () => (sourceDate ? getCoursesOnDate(classes, firstWeekStartDate, sourceDate) : []),
    [classes, firstWeekStartDate, sourceDate]
  )
  const selectedCourses = sourceCourses.filter((course) => !excludedIds.has(course.id))

  const handlePickDate = (date: Date | undefined) => {
    setSourceDate(date)
    setExcludedIds(new Set())
  }

  const toggleCourse = (courseId: string) => {
    setExcludedIds((previous) => {
      const next = new Set(previous)
      if (next.has(courseId)) next.delete(courseId)
      else next.add(courseId)
      return next
    })
  }

  const targetLabel = `${targetDate ? `${format(targetDate, 'M月d日')} ` : ''}${dayNames[targetDayOfWeek]}`

  return (
    <div className="flex max-h-[calc(100dvh-6rem)] flex-col gap-4 md:max-h-[76vh]">
      <DialogHeader className="pr-8 text-left">
        <DialogTitle className="text-lg">{targetLabel} 当天的快捷操作</DialogTitle>
      </DialogHeader>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
        {/* 补课操作 */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">补课操作</h3>
          {!firstWeekStartDate ? (
            <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              需要先在「个人中心」设置开学日期，才能按日期把当天课程补过来。
            </p>
          ) : (
            <>
              <DatePicker date={sourceDate} onSelect={handlePickDate} placeholder="选择要补哪天的课" className="w-full" />

              {!sourceDate ? (
                <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">选择日期后，这里会列出那天的全部课程。</p>
              ) : sourceCourses.length === 0 ? (
                <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  {format(sourceDate, 'M月d日', { locale: zhCN })} 没有可补的课程。
                </p>
              ) : (
                <div className="space-y-1">
                  {sourceCourses.map((course) => {
                    const isSelected = !excludedIds.has(course.id)
                    return (
                      <button
                        key={course.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleCourse(course.id)}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                          isSelected ? 'border-primary bg-primary/5' : 'border-border opacity-60 hover:opacity-100'
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                            isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                          )}
                        >
                          {isSelected && <Check className="size-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">{course.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            第 {course.startSection}
                            {course.startSection === course.endSection ? '' : `-${course.endSection}`} 节
                            {course.classroom ? ` · ${course.classroom}` : ''}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              <Button
                type="button"
                className="min-h-10 w-full"
                onClick={() => onConfirmMakeup(selectedCourses)}
                disabled={selectedCourses.length === 0}
              >
                补过来{selectedCourses.length > 0 ? `（${selectedCourses.length}）` : ''}
              </Button>
            </>
          )}
        </section>

        {/* 放假操作 */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">放假操作</h3>
          <input
            type="text"
            value={holidayName}
            onChange={(event) => setHolidayName(event.target.value)}
            placeholder="输入当天节日名称，如 国庆节"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
          />
          <p className="text-xs text-muted-foreground">
            「今天放假」会把 {targetLabel} 的 {targetCourseCount} 节课全部标记为已上，并把备注写成节日名称。
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-10 w-full"
            onClick={() => onConfirmHoliday(holidayName.trim())}
            disabled={holidayName.trim().length === 0 || targetCourseCount === 0}
          >
            <PartyPopper />
            今天放假
          </Button>
        </section>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11 w-full md:min-h-9" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      </DialogFooter>
    </div>
  )
}
