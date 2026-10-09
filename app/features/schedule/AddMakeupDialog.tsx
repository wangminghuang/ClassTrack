import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { cn } from '~/lib/utils'
import { dayNames } from './constants'
import type { MakeupCourseOption } from './makeupLesson'

export type MakeupTarget = {
  dayOfWeek: number
  section: number
}

type AddMakeupDialogProps = {
  open: boolean
  /** 目标空格子（周几 + 第几节）；为空时不渲染内容。 */
  target: MakeupTarget | null
  currentWeek: number
  /** 可选的源课程（只能从现有课程里选）。 */
  options: MakeupCourseOption[]
  onOpenChange: (open: boolean) => void
  onConfirm: (option: MakeupCourseOption) => void
}

/**
 * 「在空格子里补一节课」的选择弹窗。
 *
 * 用途：记录补课——在空白时段补一节**已存在的**课程。因此这里只提供「从现有课程里挑一门」的能力，
 * 不支持手输新课程信息；占用的节次长度与具体落位由上层（`SchedulePage`）按所选课程推导。
 */
export default function AddMakeupDialog({ open, target, currentWeek, options, onOpenChange, onConfirm }: AddMakeupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-hidden rounded-lg p-4 md:max-w-md md:p-6">
        {target && (
          <AddMakeupDialogBody
            key={`${target.dayOfWeek}-${target.section}`}
            target={target}
            currentWeek={currentWeek}
            options={options}
            onClose={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type AddMakeupDialogBodyProps = {
  target: MakeupTarget
  currentWeek: number
  options: MakeupCourseOption[]
  onClose: () => void
  onConfirm: (option: MakeupCourseOption) => void
}

function AddMakeupDialogBody({ target, currentWeek, options, onClose, onConfirm }: AddMakeupDialogBodyProps) {
  // 选中项的清空靠外层按目标格子 `key` 重挂本组件来保证，这里无需额外 effect。
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const selected = options.find((option) => option.key === selectedKey) ?? null

  const handleConfirm = () => {
    if (!selected) return
    onConfirm(selected)
  }

  return (
    <div className="flex max-h-[calc(100dvh-6rem)] flex-col gap-4 md:max-h-[70vh]">
      <DialogHeader className="pr-8 text-left">
        <DialogTitle className="text-lg">补一节课</DialogTitle>
        <DialogDescription>
          第 {currentWeek} 周 · {dayNames[target.dayOfWeek]} · 第 {target.section} 节 —— 从现有课程中选择要补的课
        </DialogDescription>
      </DialogHeader>

      {options.length === 0 ? (
        <p className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">还没有可选课程，请先导入课程后再补课。</p>
      ) : (
        <div className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
          {options.map((option) => {
            const isSelected = option.key === selectedKey
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedKey(option.key)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
                  isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60'
                )}
              >
                <span className="text-sm font-medium text-foreground">{option.source.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[option.source.teacher, option.source.classroom].filter(Boolean).join(' · ') || '无教师 / 教室信息'}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <DialogFooter className="grid grid-cols-2 gap-2 md:flex">
        <Button type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={onClose}>
          取消
        </Button>
        <Button type="button" className="min-h-11 md:min-h-9" onClick={handleConfirm} disabled={!selected}>
          补课
        </Button>
      </DialogFooter>
    </div>
  )
}
