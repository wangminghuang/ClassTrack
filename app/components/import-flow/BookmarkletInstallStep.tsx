import { BookmarkletButton } from '~/components/common/BookmarkletButton'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { ImportStepDescription } from './ImportStepDescription'
import type { BookmarkletAdapter } from '~/lib/types'

type BookmarkletInstallStepProps = {
  adapter: BookmarkletAdapter | undefined
  term: string
  bookmarkletHref: string
  onTermChange: (term: string) => void
  onCopyBookmarklet: () => void
}

const installDescriptionSteps = [
  '确认学年学期代码正确。',
  '将下方“数据导出器”按钮拖拽到浏览器书签栏以安装。',
  '如果无法拖拽，可以点击“复制书签脚本”后手动新建书签 / 网页 / 收藏。',
  '安装完成后点击下一步。',
]

export function BookmarkletInstallStep({ adapter, term, bookmarkletHref, onTermChange, onCopyBookmarklet }: BookmarkletInstallStepProps) {
  if (!adapter) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        当前学校暂未配置书签脚本导出器，请提issue反馈学校名称。
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="term" className="text-base sm:text-sm">
          学年学期代码
        </Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Input
                id="term"
                value={term}
                placeholder={adapter.defaultTerm}
                onChange={(event) => onTermChange(event.target.value)}
                className="min-h-11 text-base sm:min-h-9 sm:text-sm"
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              已按当前日期自动填入，如不正确请手动修改。该参数会写入书签脚本，修改后需要重新拖拽安装或复制脚本。
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <ImportStepDescription steps={installDescriptionSteps} />

      <div className="grid grid-cols-2 gap-2">
        <BookmarkletButton href={bookmarkletHref} />
        <Button type="button" variant="outline" onClick={onCopyBookmarklet}>
          复制脚本代码
        </Button>
      </div>
    </div>
  )
}
