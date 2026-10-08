import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import FirstWeekStartDatePicker from '~/components/common/FirstWeekStartDatePicker'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Separator } from '~/components/ui/separator'
import { cn } from '~/lib/utils'

export type CourseImportShellStatus = 'idle' | 'opening' | 'ready' | 'captured' | 'failed' | 'handing-off'

type CourseImportShellProps = {
  variant?: 'dialog' | 'native'
  term: string
  onTermChange: (term: string) => void
  firstWeekStartDate: string | null
  onFirstWeekStartDateChange: (date: string | null) => void
  status: CourseImportShellStatus
  error: string | null
  onBack?: () => void
  onRefresh?: () => void
  canRefresh?: boolean
  onPrimary?: () => void
  onCancel?: () => void
}

const importDescriptionSteps = [
  '确认学年学期代码正确，然后点击“打开教务系统并导入”。',
  '在应用内页面完成登录、验证码和菜单导航，进入金智课表详情页。',
  '如果没有自动捕获，请刷新课表详情页后重试；ClassTrack 不会读取账号、密码或 Cookie。',
]

const statusContent: Record<
  CourseImportShellStatus,
  { label: string; title: string; description: string; variant: 'secondary' | 'default' | 'destructive' }
> = {
  idle: { label: '准备就绪', title: '准备打开教务系统', description: '确认输入后开始应用内导入。', variant: 'secondary' },
  opening: { label: '加载中', title: '正在打开教务系统', description: '请在下方页面完成登录和课表导航。', variant: 'secondary' },
  ready: { label: '可操作', title: '教务页面已打开', description: '进入课表详情页后，可以请求导入当前课表。', variant: 'secondary' },
  captured: { label: '已捕获', title: '已捕获课表响应', description: '确认后将把课程交给现有解析器导入。', variant: 'default' },
  failed: {
    label: '需要处理',
    title: '导入暂时无法继续',
    description: '请检查提示并重试，或返回选择其他导入方式。',
    variant: 'destructive',
  },
  'handing-off': { label: '导入中', title: '正在交接课表数据', description: '请稍候，课程将由现有解析器处理。', variant: 'secondary' },
}

export function CourseImportShell({
  variant = 'dialog',
  term,
  onTermChange,
  firstWeekStartDate,
  onFirstWeekStartDateChange,
  status,
  error,
  onBack,
  onRefresh,
  canRefresh = true,
  onPrimary,
  onCancel,
}: CourseImportShellProps) {
  const content = statusContent[status]
  const isNative = variant === 'native'
  const isActive = status === 'opening' || status === 'ready' || status === 'captured' || status === 'handing-off'

  const compactNative = isNative && isActive
  return (
    <main
      className={cn(
        'mx-auto flex w-full max-w-2xl flex-col gap-4 bg-background p-4 text-foreground sm:p-6',
        isNative && 'max-w-none',
        !compactNative && 'min-h-full',
        compactNative && 'min-h-0'
      )}
    >
      <Card className={cn('shadow-sm', isNative && 'border-0 shadow-none')}>
        <CardHeader className={cn(isNative && 'px-0 pt-0')}>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>应用内导入课程表</CardTitle>
              <CardDescription className="text-base leading-7 sm:text-sm sm:leading-6">
                在受限的天津理工大学教务页面内完成登录和课表导入。
              </CardDescription>
            </div>
            <Badge variant={content.variant}>{content.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className={cn('space-y-5', isNative && 'px-0')}>
          {!isActive && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${variant}-native-term`} className="text-base sm:text-sm">
                  学年学期代码
                </Label>
                <Input
                  id={`${variant}-native-term`}
                  value={term}
                  placeholder="例如 2025-2026-2"
                  onChange={(event) => onTermChange(event.target.value)}
                  className="min-h-11 text-base sm:min-h-9 sm:text-sm"
                />
                <p className="text-base leading-7 text-muted-foreground sm:text-sm sm:leading-6">
                  该代码只用于课表页面未主动请求时的同源补抓请求。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${variant}-native-first-week-start-date`} className="text-base sm:text-sm">
                  第一周第一天
                </Label>
                <FirstWeekStartDatePicker
                  value={firstWeekStartDate}
                  onChange={onFirstWeekStartDateChange}
                  placeholder="请选择第一周第一天"
                  showIcon={false}
                  className="min-h-11 w-full text-base sm:min-h-9 sm:text-sm"
                />
                <p className="text-base leading-7 text-muted-foreground sm:text-sm sm:leading-6">
                  用于按导入时刻自动标记已上课程，请选择本学期第一周的周一。
                </p>
              </div>
            </div>
          )}

          {!compactNative && (
            <>
              <div className="rounded-md border bg-muted/30 p-4 text-base leading-7 text-muted-foreground sm:text-sm sm:leading-6">
                <ol className="list-decimal space-y-2 pl-5 sm:space-y-1">
                  {importDescriptionSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>

              <div className="flex items-start gap-2 rounded-md border p-3 text-base leading-7 text-muted-foreground sm:text-sm sm:leading-6">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <span>登录始终发生在天津理工大学教务系统页面内，原始响应只在本次导入期间传递，不会写入备份或浏览器存储。</span>
              </div>
            </>
          )}

          <Separator />

          <Card className={cn('shadow-none', status === 'failed' && 'border-destructive/40', status === 'captured' && 'border-primary/40')}>
            <CardContent className="flex items-start gap-3 p-4">
              {status === 'opening' || status === 'handing-off' ? (
                <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground" />
              ) : status === 'captured' ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
              ) : status === 'failed' ? (
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
              ) : (
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{content.title}</p>
                <p className="text-base leading-7 text-muted-foreground sm:text-sm sm:leading-6">{error || content.description}</p>
              </div>
            </CardContent>
          </Card>

          {isNative && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={onBack}>
                <ArrowLeft />
                返回
              </Button>
              {status !== 'failed' && (
                <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={onRefresh} disabled={!isActive || !canRefresh}>
                  <RefreshCw />
                  刷新
                </Button>
              )}
              <Button className="min-h-11 sm:min-h-9" onClick={onPrimary} disabled={status === 'handing-off' || status === 'opening'}>
                {status === 'captured' ? '导入当前课表' : status === 'ready' ? '请求导入' : status === 'failed' ? '重试' : '打开教务系统'}
              </Button>
              {onCancel && (
                <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={onCancel}>
                  取消
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
