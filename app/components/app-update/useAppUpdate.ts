import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { UPDATE_CHANNEL_LABELS } from '~/lib/app-update/channels'
import type { UpdateCandidate, UpdateChannel } from '~/lib/app-update/channels'
import { runUpdateCheck } from '~/lib/app-update/check'
import { fetchReleaseCandidates } from '~/lib/app-update/releases-api'
import { nextCheckDelay } from '~/lib/app-update/schedule'
import { addAppStateListener, readAppIsActive, readAppVersionInfo } from '~/lib/app-update/native-update'
import { isAndroidApp } from '~/lib/native-platform'
import { useUpdateStore } from '~/store/updateStore'

export type AppUpdateApi = {
  supported: boolean
  isAppActive: boolean
  currentVersion: string | null
  versionUnavailable: boolean
  channel: UpdateChannel | null
  channelLabel: string
  autoCheck: boolean
  isChecking: boolean
  lastCheckAt: number | null
  candidate: UpdateCandidate | null
  setChannel: (channel: UpdateChannel) => void
  setAutoCheck: (enabled: boolean) => void
  checkNow: () => Promise<void>
  dismissCandidate: () => void
  skipCandidate: () => void
}

type UseAppUpdateOptions = {
  /** 仅根组件 Runner 驱动生命周期与定时检查，设置卡片只消费状态。 */
  autoCheck?: boolean
}

export function useAppUpdate({ autoCheck = false }: UseAppUpdateOptions = {}): AppUpdateApi {
  const supported = isAndroidApp()
  const channel = useUpdateStore((state) => state.channel)
  const autoCheckEnabled = useUpdateStore((state) => state.autoCheck)
  const interval = useUpdateStore((state) => state.interval)
  const lastCheckAt = useUpdateStore((state) => state.lastCheckAt)
  const lastAttemptAt = useUpdateStore((state) => state.lastAttemptAt)
  const currentVersion = useUpdateStore((state) => state.currentVersion)
  const versionUnavailable = useUpdateStore((state) => state.versionUnavailable)
  const isChecking = useUpdateStore((state) => state.isChecking)
  const isAppActive = useUpdateStore((state) => state.isAppActive)
  const candidate = useUpdateStore((state) => state.pendingCandidate)
  const setChannel = useUpdateStore((state) => state.setChannel)
  const setAutoCheck = useUpdateStore((state) => state.setAutoCheck)

  const loadVersion = useCallback(async (): Promise<string | null> => {
    const info = await readAppVersionInfo()
    const store = useUpdateStore.getState()
    store.setVersionUnavailable(!info)
    if (!info) return null
    store.setCurrentVersion(info.version)
    store.seedChannelOnce(info.version)
    return info.version
  }, [])

  const runCheck = useCallback(
    async (manual: boolean) => {
      const store = useUpdateStore.getState()
      if (!supported || !store.isAppActive || store.isChecking || (!manual && !store.autoCheck)) return
      if (!manual && import.meta.env.DEV) return

      // 先取得所有权，再 await；其它入口不能清除此轮检查的标志。
      store.setIsChecking(true)
      try {
        const outcome = await runUpdateCheck({
          manual,
          supported,
          autoCheckEnabled: store.autoCheck,
          interval: store.interval,
          lastCheckAt: store.lastCheckAt,
          lastAttemptAt: store.lastAttemptAt,
          inFlight: store.isChecking,
          currentVersion: store.currentVersion,
          channel: store.channel,
          skippedVersion: store.skippedVersion,
          now: Date.now(),
          loadVersion,
          markAttempted: store.markAttempted,
          markChecked: store.markChecked,
          fetchCandidates: fetchReleaseCandidates,
        })
        const latest = useUpdateStore.getState()
        if (outcome.kind === 'found') {
          // 请求中退后台时保留候选，Runner 回前台才渲染；全程不发系统通知。
          if (manual || latest.autoCheck) latest.setPendingCandidate(outcome.candidate)
        } else if (manual && latest.isAppActive) {
          if (outcome.kind === 'failed') toast.error('检查更新失败，请稍后再试')
          if (outcome.kind === 'version-unavailable') toast.error('无法读取当前版本，请稍后再试')
          if (outcome.kind === 'up-to-date') toast.success('已是最新版本')
        }
      } finally {
        useUpdateStore.getState().setIsChecking(false)
      }
    },
    [loadVersion, supported]
  )

  useEffect(() => {
    if (!autoCheck || !supported) return
    let disposed = false
    let receivedStateEvent = false
    const listener = addAppStateListener((active) => {
      receivedStateEvent = true
      if (!disposed) useUpdateStore.getState().setAppActive(active)
    })
    void listener.then(async () => {
      const active = await readAppIsActive()
      // 异步读取不能覆盖更晚收到的原生生命周期事件。
      if (!disposed && !receivedStateEvent && active !== null) useUpdateStore.getState().setAppActive(active)
    })
    void loadVersion()
    return () => {
      disposed = true
      void listener.then((handle) => handle?.remove())
    }
  }, [autoCheck, supported, loadVersion])

  useEffect(() => {
    if (!autoCheck || !supported || !isAppActive || !autoCheckEnabled || isChecking || versionUnavailable || currentVersion === null) return
    if (import.meta.env.DEV) return
    // 冷启动、回前台和持续前台共用同一到期时间；退后台时清理定时器。
    const delay = nextCheckDelay({ interval, lastCheckAt, lastAttemptAt, now: Date.now() })
    const timer = window.setTimeout(() => void runCheck(false), delay)
    return () => window.clearTimeout(timer)
  }, [
    autoCheck,
    supported,
    isAppActive,
    autoCheckEnabled,
    isChecking,
    versionUnavailable,
    currentVersion,
    interval,
    lastCheckAt,
    lastAttemptAt,
    runCheck,
  ])

  const checkNow = useCallback(() => runCheck(true), [runCheck])
  const dismissCandidate = useCallback(() => useUpdateStore.getState().setPendingCandidate(null), [])
  const skipCandidate = useCallback(() => {
    const store = useUpdateStore.getState()
    if (store.pendingCandidate) store.skipVersion(store.pendingCandidate.version)
    store.setPendingCandidate(null)
  }, [])

  return {
    supported,
    isAppActive,
    currentVersion,
    versionUnavailable,
    channel,
    channelLabel: channel ? UPDATE_CHANNEL_LABELS[channel] : '未设置',
    autoCheck: autoCheckEnabled,
    isChecking,
    lastCheckAt,
    candidate,
    setChannel,
    setAutoCheck,
    checkNow,
    dismissCandidate,
    skipCandidate,
  }
}
