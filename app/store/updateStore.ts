import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { seedChannel } from '~/lib/app-update/channels'
import type { UpdateCandidate, UpdateChannel } from '~/lib/app-update/channels'
import { DEFAULT_UPDATE_SETTINGS, normalizeUpdateSettings } from '~/lib/app-update/settings'
import type { AppUpdateSettings } from '~/lib/app-update/settings'

/**
 * 更新检测的设置与应用内提示状态。
 *
 * 为什么独立成一个 store（而不是塞进 `useClassStore`）：这里的每一项都是**设备相关**的偏好，
 * 不该跟着备份 JSON 迁移到新设备，也不该牵动 `class-track-storage` 的 schema 版本与迁移逻辑。
 * 与 `mobileNavigationStore` 同一约定。
 */

export const UPDATE_STORAGE_KEY = 'class-track-update'

/** 会被写进 localStorage 的部分（默认值、收窄与存量提升规则见 `app/lib/app-update/settings.ts`）。 */
export type { AppUpdateSettings }

/** 只在本次会话内有效的状态，**不落盘**（刷新后回到初始值）。 */
export type AppUpdateSession = {
  /** 当前安装版本名；从原生读到之前为 `null`。 */
  currentVersion: string | null
  /** 原生前台状态；后台保留候选，但不渲染提示、不启动检查。 */
  isAppActive: boolean
  /** 版本信息读取失败（插件不可用 / 异常）：此时整个功能静默禁用（prd F1）。 */
  versionUnavailable: boolean
  /** 有一次检查正在进行中。既是设置页的按钮禁用依据，也是重入保护的闸门输入。 */
  isChecking: boolean
  /** 待提示的候选版本；模态框读它（挂在 `app/root.tsx` 的那一份）。 */
  pendingCandidate: UpdateCandidate | null
}

type AppUpdateActions = {
  /** 通道播种：只在存储里没有值时写一次，已有值永不覆盖（见 `channels.ts` 的 `seedChannel`）。 */
  seedChannelOnce: (versionName: string) => void
  setChannel: (channel: UpdateChannel) => void
  setAutoCheck: (enabled: boolean) => void
  setAppActive: (active: boolean) => void
  /** 记「上一次成功拿到结果」（间隔窗口的唯一依据）。失败**不要**调它。 */
  markChecked: (at: number) => void
  /** 记「上一次尝试」（成功失败都调；只为失败后的短冷却服务）。 */
  markAttempted: (at: number) => void
  setCurrentVersion: (version: string) => void
  setVersionUnavailable: (unavailable: boolean) => void
  setIsChecking: (checking: boolean) => void
  setPendingCandidate: (candidate: UpdateCandidate | null) => void
  skipVersion: (version: string) => void
}

export type AppUpdateStore = AppUpdateSettings & AppUpdateSession & AppUpdateActions

const SETTINGS_DEFAULTS: AppUpdateSettings = DEFAULT_UPDATE_SETTINGS

export const useUpdateStore = create<AppUpdateStore>()(
  persist(
    (set, get) => ({
      ...SETTINGS_DEFAULTS,
      currentVersion: null,
      isAppActive: false,
      versionUnavailable: false,
      isChecking: false,
      pendingCandidate: null,

      seedChannelOnce: (versionName) => {
        if (get().channel !== null) return
        set({ channel: seedChannel(null, versionName) })
      },

      setChannel: (channel) => set({ channel }),
      setAutoCheck: (enabled) => set({ autoCheck: enabled }),
      setAppActive: (active) => set({ isAppActive: active }),
      markChecked: (at) => set({ lastCheckAt: at }),
      markAttempted: (at) => set({ lastAttemptAt: at }),
      setCurrentVersion: (version) => set({ currentVersion: version }),
      setVersionUnavailable: (unavailable) => set({ versionUnavailable: unavailable }),
      setIsChecking: (checking) => set({ isChecking: checking }),
      setPendingCandidate: (candidate) => set({ pendingCandidate: candidate }),
      skipVersion: (version) => set({ skippedVersion: version }),
    }),
    {
      name: UPDATE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        channel: state.channel,
        autoCheck: state.autoCheck,
        interval: state.interval,
        lastCheckAt: state.lastCheckAt,
        lastAttemptAt: state.lastAttemptAt,
        skippedVersion: state.skippedVersion,
      }),
      merge: (persistedState, currentState) => ({
        // localStorage 是外部输入：坏值（手改、旧版本、别的应用写的同名键）一律逐字段回落到默认，
        // 而不是让一个非法通道值把检查逻辑带进未定义分支。收窄规则与默认值都在
        // `app/lib/app-update/settings.ts`（由 `settings.test.ts` 钉住）。
        //
        // normalize 同时将所有历史间隔迁移为固定 6 小时，丢弃旧通知字段。
        ...currentState,
        ...normalizeUpdateSettings(persistedState, currentState),
      }),
    }
  )
)
