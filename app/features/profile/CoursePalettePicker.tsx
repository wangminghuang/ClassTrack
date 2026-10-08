import { Check } from 'lucide-react'
import type { CoursePaletteId } from '~/lib/types'
import { cn } from '~/lib/utils'
import { useScheduleDisplayStore } from '~/store/scheduleDisplayStore'
import { COURSE_PALETTES } from '~/features/schedule/courseColor'

const paletteIds: CoursePaletteId[] = ['original', 'adjusted']
const previewNames = ['数据结构', '概率统计', '程序设计', '计算机组成', '专业英语', '思政课', '形势政策', '体育']

export default function CoursePalettePicker() {
  const selectedPalette = useScheduleDisplayStore((state) => state.coursePalette)
  const setCoursePalette = useScheduleDisplayStore((state) => state.setCoursePalette)

  return (
    <fieldset id="course-palette" className="min-w-0 space-y-3 border-t border-border pt-5">
      <legend className="float-left mb-1 w-full text-sm font-medium">课程配色</legend>
      <p className="clear-both text-xs leading-5 text-muted-foreground">选择后立即应用，配色会在这台设备上保留。</p>
      <div className="grid gap-3 md:grid-cols-2">
        {paletteIds.map((id) => {
          const palette = COURSE_PALETTES[id]
          const selected = selectedPalette === id

          return (
            <label key={id} className="block min-w-0 cursor-pointer">
              <input
                type="radio"
                name="course-palette"
                value={id}
                checked={selected}
                onChange={() => setCoursePalette(id)}
                className="peer sr-only"
                aria-label={palette.name}
              />
              <div
                className={cn(
                  'rounded-lg border p-3 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                  selected ? 'border-foreground/60 bg-muted/30' : 'border-border bg-card hover:border-foreground/30'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{palette.name}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border',
                      selected ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground/40'
                    )}
                  >
                    {selected && <Check className="size-3.5" />}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{palette.description}</p>
                <p className="mb-2 mt-3 text-xs text-muted-foreground">课程预览</p>
                <div className="grid grid-cols-4 gap-1.5" aria-label={`${palette.name}课程预览`}>
                  {palette.themes.map((theme, index) => (
                    <div
                      key={index}
                      data-palette-sample={id}
                      data-palette-index={index}
                      className={cn(
                        'flex min-h-16 min-w-0 flex-col justify-between rounded-md px-1.5 py-2 text-white shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.45)]',
                        theme.surface
                      )}
                    >
                      <span className="break-words text-[10px] font-semibold leading-4">{previewNames[index]}</span>
                      <span className="mt-1 text-[9px] leading-3 text-white/85">A203</span>
                    </div>
                  ))}
                </div>
                <p className="mb-1.5 mt-3 text-xs text-muted-foreground">非本周课程</p>
                <div className="grid grid-cols-8 gap-1.5" aria-label={`${palette.name}非本周预览`}>
                  {palette.outOfWeekThemes.map((theme, index) => (
                    <span key={index} data-palette-muted-sample={id} className={cn('h-5 rounded-sm', theme.surface)} aria-hidden="true" />
                  ))}
                </div>
              </div>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
