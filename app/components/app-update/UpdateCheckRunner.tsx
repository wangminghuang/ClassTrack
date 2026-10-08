import UpdateAvailableDialog from './UpdateAvailableDialog'
import { useAppUpdate } from './useAppUpdate'

/**
 * 更新检测的**挂载点**（挂在 `app/root.tsx`，与 `WidgetGuideDialog` 同一处）。
 *
 * 这一个组件负责两件事，因此必须是**唯一**一份实例：
 * 1. 驱动自动检查（冷启动 + 回到前台 + 持续前台，固定 6 小时间隔）—— 由 `useAppUpdate({ autoCheck: true })` 提供；
 * 2. 渲染「发现新版本」模态框。
 *
 * 平台与插件能力判定都在 hook 内部：非 Android 时 `candidate` 恒为 `null`，这里直接不渲染。
 */
export default function UpdateCheckRunner() {
  const { supported, isAppActive, candidate, currentVersion, dismissCandidate, skipCandidate } = useAppUpdate({ autoCheck: true })

  if (!supported || !isAppActive || !candidate) return null

  return (
    <UpdateAvailableDialog
      candidate={candidate}
      currentVersion={currentVersion ?? '未知版本'}
      onDismiss={dismissCandidate}
      onSkip={skipCandidate}
    />
  )
}
