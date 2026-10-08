import { afterAll, describe, expect, it, vi } from 'vitest'
import { useUpdateStore } from './updateStore'

vi.hoisted(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})
afterAll(() => vi.unstubAllGlobals())

describe('更新设置持久化与前台状态', () => {
  const options = useUpdateStore.persist.getOptions()
  it('只持久化设备设置，前台状态、检查中和候选不落盘，不保留通知字段', () => {
    const saved = options.partialize?.(useUpdateStore.getState())
    expect(Object.keys(saved ?? {}).sort()).toEqual(
      ['autoCheck', 'channel', 'interval', 'lastAttemptAt', 'lastCheckAt', 'skippedVersion'].sort()
    )
  })
  it('旧设备间隔统一 6 小时，恢复设置不能覆盖会话前台状态', () => {
    const state = useUpdateStore.getState()
    const merged = options.merge?.(
      { interval: '1d', intervalPinned: true, notify: true, isAppActive: true, channel: 'all', autoCheck: false },
      state
    )
    expect(merged).toMatchObject({ interval: '6h', isAppActive: false, channel: 'all', autoCheck: false })
    expect(merged).not.toHaveProperty('notify')
  })
  it('退后台保留候选，回前台可以继续显示，无需重复请求', () => {
    const state = useUpdateStore.getState()
    const candidate = { version: '1.0.27-beta', prerelease: true, tag: 'android-beta-27', title: '', notes: '', pageUrl: '' }
    state.setPendingCandidate(candidate)
    state.setAppActive(false)
    expect(useUpdateStore.getState().pendingCandidate).toEqual(candidate)
    state.setAppActive(true)
    expect(useUpdateStore.getState().pendingCandidate).toEqual(candidate)
    state.setPendingCandidate(null)
    state.setAppActive(false)
  })
})
