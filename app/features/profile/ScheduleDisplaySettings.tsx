import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Switch } from '~/components/ui/switch'
import { useAttendanceStore } from '~/store/attendanceStore'
import { useScheduleDisplayStore } from '~/store/scheduleDisplayStore'
import CoursePalettePicker from './CoursePalettePicker'

export default function ScheduleDisplaySettings() {
  // 出勤痕迹是两层开关：能力层（出勤统计）关掉时，这一层的出勤开关就没有可显示的东西，
  // 因此整行跟着收起；「淡化显示非本周课程」与出勤无关，任何情况下都保持可用。
  const attendanceEnabled = useAttendanceStore((state) => state.enabled)
  const showAttendanceStatus = useScheduleDisplayStore((state) => state.showAttendanceStatus)
  const showOutOfWeekCourses = useScheduleDisplayStore((state) => state.showOutOfWeekCourses)
  const collapseEmptyWeekdayColumns = useScheduleDisplayStore((state) => state.collapseEmptyWeekdayColumns)
  const edgeSwipeWeekSwitch = useScheduleDisplayStore((state) => state.edgeSwipeWeekSwitch)
  const setShowAttendanceStatus = useScheduleDisplayStore((state) => state.setShowAttendanceStatus)
  const setShowOutOfWeekCourses = useScheduleDisplayStore((state) => state.setShowOutOfWeekCourses)
  const setCollapseEmptyWeekdayColumns = useScheduleDisplayStore((state) => state.setCollapseEmptyWeekdayColumns)
  const setEdgeSwipeWeekSwitch = useScheduleDisplayStore((state) => state.setEdgeSwipeWeekSwitch)

  return (
    <Card id="card-schedule-display">
      <CardHeader>
        <CardTitle>课表显示</CardTitle>
        <CardDescription>调整课表的信息显示与课程配色。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {attendanceEnabled && (
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="space-y-0.5">
              <label className="text-sm font-medium" htmlFor="schedule-display-attendance">
                在课表上显示出勤状态
              </label>
              <p className="text-xs text-muted-foreground">已上课程打勾，未上课程淡化显示。</p>
            </div>
            <Switch
              id="schedule-display-attendance"
              className="self-start"
              checked={showAttendanceStatus}
              onCheckedChange={setShowAttendanceStatus}
              aria-label="在课表上显示出勤状态"
            />
          </div>
        )}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-0.5">
            <label className="text-sm font-medium" htmlFor="schedule-display-out-of-week">
              淡化显示非本周课程
            </label>
            <p className="text-xs text-muted-foreground">本周没有的课程以灰色卡片显示，方便查看整周安排。</p>
          </div>
          <Switch
            id="schedule-display-out-of-week"
            className="self-start"
            checked={showOutOfWeekCourses}
            onCheckedChange={setShowOutOfWeekCourses}
            aria-label="淡化显示非本周课程"
          />
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-0.5">
            <label className="text-sm font-medium" htmlFor="schedule-display-collapse-empty-days">
              收起整周无课的日期列
            </label>
            <p className="text-xs text-muted-foreground">
              把整周都没有课程的日期列收窄，宽度让给有课的日期。开启后翻周时列宽会随当周课程变化。
            </p>
          </div>
          <Switch
            id="schedule-display-collapse-empty-days"
            className="self-start"
            checked={collapseEmptyWeekdayColumns}
            onCheckedChange={setCollapseEmptyWeekdayColumns}
            aria-label="收起整周无课的日期列"
          />
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-0.5">
            <label className="text-sm font-medium" htmlFor="schedule-display-edge-swipe-week">
              左右边缘滑动切换周
            </label>
            <p className="text-xs text-muted-foreground">
              仅手机端：横向滑到课表最左或最右边缘后继续拖动，跟手阻尼回弹，松手即切换上一周或下一周。
            </p>
          </div>
          <Switch
            id="schedule-display-edge-swipe-week"
            className="self-start"
            checked={edgeSwipeWeekSwitch}
            onCheckedChange={setEdgeSwipeWeekSwitch}
            aria-label="左右边缘滑动切换周"
          />
        </div>
        <CoursePalettePicker />
      </CardContent>
    </Card>
  )
}
