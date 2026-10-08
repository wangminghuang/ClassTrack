import { format } from 'date-fns'
import { RefreshCw } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { useAppUpdate } from '~/components/app-update/useAppUpdate'
import { UPDATE_CHANNELS, UPDATE_CHANNEL_HINTS, UPDATE_CHANNEL_LABELS } from '~/lib/app-update/channels'
import type { UpdateChannel } from '~/lib/app-update/channels'
import { parseAppVersion } from '~/lib/app-update/version'

/**
 * 个人中心的「应用更新」卡片（prd F6）。
 *
 * 只在 Android 原生渲染（`useAppUpdate().supported`）：浏览器 / PWA 的更新由 Service Worker 负责，
 * 在那边显示原生更新设置只会是死控件。与 `WidgetPrecisionSettings` 同一处理方式。
 *
 * **通道的默认值不在这里决定**：`useAppUpdate` 首次读到版本名时按安装包类型播种一次，
 * 之后无论安装包换成正式版还是测试版都不再改（用户 2026-09-23 口径）。
 */
export default function AppUpdateSettings() {
  const {
    supported,
    versionUnavailable,
    currentVersion,
    channel,
    channelLabel,
    autoCheck,
    isChecking,
    lastCheckAt,
    setChannel,
    setAutoCheck,
    checkNow,
  } = useAppUpdate()

  // 版本信息读不到就整张卡片不渲染：一个说不出「当前是什么版本」的更新设置在误导用户。
  if (!supported || versionUnavailable) return null

  // 安装包的版本名必须能解析（`X.Y.Z` 或 `1.0.N-beta`）才能比较大小。不满足时**任何更新都判不出来**，
  // 这几乎是本机调试包独有的事（`build.gradle` 在没给 CLASSTRACK_VERSION_NAME 时回落到 `1.0`）：
  // 与其静默什么都不做，不如在卡片里说清楚。
  const versionComparable = currentVersion === null || parseAppVersion(currentVersion) !== null

  return (
    <Card id="card-app-update">
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="space-y-1.5">
          <CardTitle>应用更新</CardTitle>
          <CardDescription>前台每 6 小时自动检查一次，发现新版本时弹窗提示。</CardDescription>
        </div>
        <Badge variant={autoCheck ? 'default' : 'secondary'} className="self-start">
          {autoCheck ? '已开启' : '已关闭'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-medium">当前版本</div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{currentVersion ?? '读取中…'}</span>
            <Badge variant="secondary">{channelLabel}</Badge>
          </div>
        </div>

        {!versionComparable && (
          <p className="text-sm text-muted-foreground">
            这个包的版本名不是 <code>x.y.z</code> 形式，无法和发布版本比较大小，所以检查更新不会提示任何结果。 本机调试构建常见（未设置{' '}
            <code>CLASSTRACK_VERSION_NAME</code> 时版本名会回落到 <code>1.0</code>）。
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="text-sm font-medium" htmlFor="app-update-auto-check">
            自动检查更新
          </label>
          <Switch
            id="app-update-auto-check"
            className="self-start"
            checked={autoCheck}
            onCheckedChange={setAutoCheck}
            aria-label="自动检查更新"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">更新通道</div>
            <p className="text-xs text-muted-foreground">
              {channel ? UPDATE_CHANNEL_HINTS[channel] : '首次读取版本后自动选择，之后一直保持。'}
            </p>
          </div>
          <Select value={channel ?? undefined} onValueChange={(value) => setChannel(value as UpdateChannel)} disabled={!channel}>
            <SelectTrigger className="h-9 w-full justify-between sm:w-[180px]" aria-label="更新通道">
              <SelectValue placeholder="读取中…" />
            </SelectTrigger>
            <SelectContent align="end">
              {UPDATE_CHANNELS.map((item) => (
                <SelectItem key={item} value={item}>
                  {UPDATE_CHANNEL_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">上次检查成功</div>
            <p className="text-xs text-muted-foreground">
              {lastCheckAt === null ? '还没有成功检查过' : format(new Date(lastCheckAt), 'yyyy-MM-dd HH:mm')}
            </p>
          </div>
          <Button
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
            type="button"
            variant="outline"
            disabled={isChecking}
            onClick={() => void checkNow()}
          >
            <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
            {isChecking ? '检查中…' : '立即检查'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
