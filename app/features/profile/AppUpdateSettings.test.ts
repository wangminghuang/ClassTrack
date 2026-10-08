import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import AppUpdateSettings from './AppUpdateSettings'
const mock = vi.hoisted(() => ({ supported: true, autoCheck: false, isChecking: false }))
vi.mock('~/components/app-update/useAppUpdate', () => ({
  useAppUpdate: () => ({ ...mock, currentVersion: '1.0.26-beta', channel: 'all', channelLabel: '全部', lastCheckAt: null }),
}))
describe('个人中心应用更新', () => {
  it('显示固定 6 小时与前台弹窗文案，移除通知与自选间隔', () => {
    const html = renderToStaticMarkup(createElement(AppUpdateSettings))
    expect(html).toContain('前台每 6 小时自动检查一次')
    expect(html).not.toContain('app-update-notify')
    expect(html).not.toContain('前往系统设置')
    expect(html).not.toContain('aria-label="检查间隔"')
  })
  it('关闭自动检查后手动按钮仍可用，检查中禁用', () => {
    const manualButton = () =>
      renderToStaticMarkup(createElement(AppUpdateSettings))
        .match(/<button[^>]*>[\s\S]*?<\/button>/g)
        ?.find((button) => button.includes('立即检查') || button.includes('检查中'))
    expect(manualButton()).not.toContain('disabled=')
    mock.isChecking = true
    expect(manualButton()).toContain('disabled=')
    mock.isChecking = false
  })
  it('浏览器仍由 PWA 提示更新，不显示原生更新卡片', () => {
    mock.supported = false
    expect(renderToStaticMarkup(createElement(AppUpdateSettings))).toBe('')
    mock.supported = true
  })
})
