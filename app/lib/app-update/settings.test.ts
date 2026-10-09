import { describe, expect, it } from 'vitest'
import { DEFAULT_UPDATE_SETTINGS, normalizeUpdateSettings } from './settings'

describe('更新设置', () => {
  it('首装默认开启自动检查，固定 6 小时；通道首次读版本后播种', () => {
    expect(DEFAULT_UPDATE_SETTINGS.autoCheck).toBe(true)
    expect(DEFAULT_UPDATE_SETTINGS.interval).toBe('6h')
    expect(DEFAULT_UPDATE_SETTINGS.channel).toBeNull()
    for (const stored of [null, undefined, {}]) expect(normalizeUpdateSettings(stored)).toEqual(DEFAULT_UPDATE_SETTINGS)
  })
  it('保留通道、开关、记账与跳过版本，不再读取旧通知设置', () => {
    const stored = {
      channel: 'beta',
      autoCheck: false,
      notify: true,
      interval: '7d',
      intervalPinned: true,
      lastCheckAt: 1_700_000_000_000,
      lastAttemptAt: 1_700_000_000_500,
      skippedVersion: '1.2.0',
    }
    expect(normalizeUpdateSettings(stored)).toEqual({
      channel: 'beta',
      autoCheck: false,
      interval: '6h',
      lastCheckAt: stored.lastCheckAt,
      lastAttemptAt: stored.lastAttemptAt,
      skippedVersion: '1.2.0',
    })
  })
  it.each(['launch', '1h', '1d', '3d', '7d', '6h', 'bad', null])('历史间隔 %s 无论是否定档都改为 6 小时', (interval) => {
    for (const intervalPinned of [true, false, undefined]) {
      expect(normalizeUpdateSettings({ interval, intervalPinned }).interval).toBe('6h')
    }
  })
  it('非法值逐字段回落', () => {
    expect(
      normalizeUpdateSettings({ channel: 'nope', autoCheck: 'yes', lastCheckAt: 'now', lastAttemptAt: {}, skippedVersion: 42 })
    ).toEqual(DEFAULT_UPDATE_SETTINGS)
  })
  it('NaN / Infinity 时间戳不能锁死调度', () => {
    const settings = normalizeUpdateSettings({ lastCheckAt: NaN, lastAttemptAt: Infinity })
    expect(settings.lastCheckAt).toBeNull()
    expect(settings.lastAttemptAt).toBeNull()
  })
  it('显式 fallback 生效，迁移幂等', () => {
    const fallback = { ...DEFAULT_UPDATE_SETTINGS, autoCheck: false }
    expect(normalizeUpdateSettings({}, fallback)).toEqual(fallback)
    expect(normalizeUpdateSettings(normalizeUpdateSettings({ interval: '1d', notify: true }))).toEqual(DEFAULT_UPDATE_SETTINGS)
  })
})
