import { normalizeChannel } from './channels'
import type { UpdateChannel } from './channels'
import { DEFAULT_CHECK_INTERVAL } from './schedule'
import type { CheckInterval } from './schedule'

/** 设备相关更新设置，独立存储，不进入课表备份。 */
export type AppUpdateSettings = {
  channel: UpdateChannel | null
  /** 只控制自动检查，手动检查始终可用。 */
  autoCheck: boolean
  interval: CheckInterval
  /** 成功结果驱动 6 小时间隔，失败尝试只驱动 60 秒冷却。 */
  lastCheckAt: number | null
  lastAttemptAt: number | null
  skippedVersion: string | null
}

export const DEFAULT_UPDATE_SETTINGS: AppUpdateSettings = {
  channel: null,
  autoCheck: true,
  interval: DEFAULT_CHECK_INTERVAL,
  lastCheckAt: null,
  lastAttemptAt: null,
  skippedVersion: null,
}

function readTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 收窄持久化设置，并把所有旧间隔统一为 6 小时；旧通知与定档字段不再读取。
 * @param stored localStorage 的外部输入。
 * @param fallback 缺失字段的默认设置。
 * @returns 完整合法的设备设置。
 */
export function normalizeUpdateSettings(stored: unknown, fallback: AppUpdateSettings = DEFAULT_UPDATE_SETTINGS): AppUpdateSettings {
  const source = (stored ?? {}) as Record<string, unknown>
  return {
    channel: normalizeChannel(source.channel),
    autoCheck: typeof source.autoCheck === 'boolean' ? source.autoCheck : fallback.autoCheck,
    interval: DEFAULT_CHECK_INTERVAL,
    lastCheckAt: readTimestamp(source.lastCheckAt),
    lastAttemptAt: readTimestamp(source.lastAttemptAt),
    skippedVersion: typeof source.skippedVersion === 'string' ? source.skippedVersion : null,
  }
}
