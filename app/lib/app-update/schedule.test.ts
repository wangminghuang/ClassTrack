import { describe, expect, it } from 'vitest'
import { DEFAULT_CHECK_INTERVAL, FAILURE_RETRY_COOLDOWN_MS, checkIntervalMs, nextCheckDelay, shouldCheckNow } from './schedule'
import type { ShouldCheckArgs } from './schedule'
const HOUR_MS = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 8, 12)
const defaults: ShouldCheckArgs = { interval: '6h', lastCheckAt: null, lastAttemptAt: null, now: NOW }

describe('固定 6 小时前台调度', () => {
  it('默认和毫秒值都是 6 小时', () => {
    expect(DEFAULT_CHECK_INTERVAL).toBe('6h')
    expect(checkIntervalMs()).toBe(6 * HOUR_MS)
  })
  it('首次与间隔到期放行，不足 6 小时拦住', () => {
    expect(shouldCheckNow(defaults)).toBe(true)
    for (const elapsed of [HOUR_MS, 6 * HOUR_MS - 1, 6 * HOUR_MS, 7 * HOUR_MS]) {
      const args = { ...defaults, lastCheckAt: NOW - elapsed, lastAttemptAt: NOW - elapsed }
      expect(shouldCheckNow(args)).toBe(elapsed >= 6 * HOUR_MS)
      expect(nextCheckDelay(args)).toBe(Math.max(0, 6 * HOUR_MS - elapsed))
    }
  })
  it('失败只受 60 秒冷却约束，不消耗 6 小时成功窗口', () => {
    for (const lastCheckAt of [null, NOW - HOUR_MS]) {
      for (const elapsed of [1000, FAILURE_RETRY_COOLDOWN_MS - 1, FAILURE_RETRY_COOLDOWN_MS, FAILURE_RETRY_COOLDOWN_MS + 1]) {
        const args = { ...defaults, lastCheckAt, lastAttemptAt: NOW - elapsed }
        expect(shouldCheckNow(args)).toBe(elapsed >= FAILURE_RETRY_COOLDOWN_MS)
        expect(nextCheckDelay(args)).toBe(Math.max(0, FAILURE_RETRY_COOLDOWN_MS - elapsed))
      }
    }
  })
  it('成功与尝试同一时刻使用 6 小时窗口，不能误走失败冷却', () => {
    const args = { ...defaults, lastCheckAt: NOW - HOUR_MS, lastAttemptAt: NOW - HOUR_MS }
    expect(shouldCheckNow(args)).toBe(false)
    expect(nextCheckDelay(args)).toBe(5 * HOUR_MS)
  })
  it('系统时间回拨时立即放行，不能被未来时间锁死', () => {
    for (const args of [
      { ...defaults, lastCheckAt: NOW + HOUR_MS, lastAttemptAt: NOW + HOUR_MS },
      { ...defaults, lastAttemptAt: NOW + HOUR_MS },
    ]) {
      expect(shouldCheckNow(args)).toBe(true)
      expect(nextCheckDelay(args)).toBe(0)
    }
  })
  it('手动忽略间隔与失败冷却，但仍受并发保护', () => {
    for (const args of [
      { ...defaults, lastCheckAt: NOW, lastAttemptAt: NOW, manual: true },
      { ...defaults, lastAttemptAt: NOW, manual: true },
    ]) {
      expect(shouldCheckNow(args)).toBe(true)
      expect(shouldCheckNow({ ...args, inFlight: true })).toBe(false)
    }
    expect(shouldCheckNow({ ...defaults, inFlight: true })).toBe(false)
  })
})
