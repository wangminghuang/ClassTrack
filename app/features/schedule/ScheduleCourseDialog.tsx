import { useState } from 'react'
import { CheckCircle2, CircleAlert, Clock3, MapPin, Trash2, UserRound } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Textarea } from '~/components/ui/textarea'
import type { Class, ClassMark } from '~/lib/types'

type ScheduleCourseDialogProps = {
  course: Class | null
  currentWeek: number
  mark: ClassMark | undefined
  /**
   * 「出勤统计」是否开启；关闭时不渲染出勤切换按钮。
   *
   * 备注输入与保存**不受影响**：备注和出勤共用同一条 `ClassMark`，但功能上互不依赖。
   */
  attendanceEnabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggleAttendance: (classId: string, week: number) => void
  onSaveNote: (classId: string, week: number, note: string) => void
  /** 删除这节课；仅对手动补课（`course.isManual`）展示删除入口。 */
  onDelete?: (classId: string) => void
}

export default function ScheduleCourseDialog({
  course,
  currentWeek,
  mark,
  attendanceEnabled,
  open,
  onOpenChange,
  onToggleAttendance,
  onSaveNote,
  onDelete,
}: ScheduleCourseDialogProps) {
  const [note, setNote] = useState(mark?.note || '')

  if (!course) return null

  const isAttended = Boolean(mark?.isAttended)
  const canDelete = Boolean(course.isManual && onDelete)
  const handleSave = () => {
    onSaveNote(course.id, currentWeek, note.trim())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg p-4 md:max-w-md md:p-6">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-xl leading-7">{course.name}</DialogTitle>
          <DialogDescription>
            第 {currentWeek} 周 ·{' '}
            {course.startSection === course.endSection
              ? `第 ${course.startSection} 节`
              : `第 ${course.startSection}-${course.endSection} 节`}
            {course.isManual && ' · 补课'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          {course.teacher && (
            <div className="flex items-center gap-2">
              <UserRound className="size-4 shrink-0" />
              <span className="break-words">{course.teacher}</span>
            </div>
          )}
          {course.classroom && (
            <div className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0" />
              <span className="break-words">{course.classroom}</span>
            </div>
          )}
          {(course.startTime || course.endTime) && (
            <div className="flex items-center gap-2">
              <Clock3 className="size-4 shrink-0" />
              <span>{[course.startTime, course.endTime].filter(Boolean).join(' - ')}</span>
            </div>
          )}
        </div>

        {attendanceEnabled && (
          <Button
            type="button"
            variant="outline"
            className={
              isAttended
                ? 'min-h-12 justify-start border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'min-h-12 justify-start border-rose-300 bg-rose-50 text-rose-800'
            }
            onClick={() => onToggleAttendance(course.id, currentWeek)}
          >
            {isAttended ? <CheckCircle2 /> : <CircleAlert />}
            {isAttended ? '已上课，点击切换为未上' : '未上课，点击切换为已上'}
          </Button>
        )}

        <div className="space-y-2">
          <label htmlFor="schedule-course-note" className="text-sm font-medium">
            本次课程备注
          </label>
          <Textarea
            id="schedule-course-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="记录代课、调课或其他事项…"
            className="min-h-32 resize-y"
          />
        </div>

        {canDelete && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 justify-start border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive md:min-h-9"
            onClick={() => {
              onDelete?.(course.id)
              onOpenChange(false)
            }}
          >
            <Trash2 />
            删除这节补课
          </Button>
        )}

        <DialogFooter className="grid grid-cols-2 gap-2 md:flex">
          <Button type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" className="min-h-11 md:min-h-9" onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
