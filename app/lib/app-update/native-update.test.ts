import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@capacitor/app'
import { addAppStateListener, readAppIsActive, readAppVersionInfo } from './native-update'
const addListenerMock = vi.hoisted(() =>
  vi.fn<(eventName: string, listener: (state: { isActive: boolean }) => void) => Promise<{ remove: () => Promise<void> }>>()
)
vi.mock('@capacitor/app', () => ({ App: { getInfo: vi.fn(), getState: vi.fn(), addListener: addListenerMock } }))
afterEach(() => vi.resetAllMocks())
describe('原生更新生命周期适配', () => {
  it('读取安装版本并收窄字段', async () => {
    vi.mocked(App.getInfo).mockResolvedValue({ id: 'app', name: 'ClassTrack', version: ' 1.0.27-beta ', build: '27' })
    expect(await readAppVersionInfo()).toEqual({ version: '1.0.27-beta', build: '27' })
  })
  it('读取前台和后台状态，插件失效返回 null', async () => {
    for (const isActive of [true, false]) {
      vi.mocked(App.getState).mockResolvedValue({ isActive })
      expect(await readAppIsActive()).toBe(isActive)
    }
    vi.mocked(App.getState).mockRejectedValue(new Error('unavailable'))
    expect(await readAppIsActive()).toBeNull()
  })
  it('前台与后台事件都必须交给调用方，不能只通知恢复前台', async () => {
    const remove = vi.fn(async () => {})
    addListenerMock.mockImplementation(async (_event, listener) => {
      listener({ isActive: false })
      listener({ isActive: true })
      return { remove }
    })
    const handler = vi.fn()
    const handle = await addAppStateListener(handler)
    expect(handler.mock.calls).toEqual([[false], [true]])
    await handle?.remove()
    expect(remove).toHaveBeenCalledOnce()
  })
  it('插件不可用时不向启动路径抛出异常', async () => {
    vi.mocked(App.getInfo).mockRejectedValue(new Error('unavailable'))
    addListenerMock.mockRejectedValue(new Error('unavailable'))
    expect(await readAppVersionInfo()).toBeNull()
    expect(await addAppStateListener(() => {})).toBeNull()
  })
})
