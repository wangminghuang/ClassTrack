import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import UpdateCheckRunner from './UpdateCheckRunner'
const mock = vi.hoisted(() => ({ supported: true, isAppActive: false, candidate: { version: '1.0.27-beta' } }))
vi.mock('./useAppUpdate', () => ({ useAppUpdate: () => ({ ...mock, currentVersion: '1.0.26-beta' }) }))
vi.mock('./UpdateAvailableDialog', () => ({ default: () => createElement('div', null, '更新模态框') }))
describe('更新模态框前台边界', () => {
  it('后台即使收到候选也不渲染，回前台才渲染', () => {
    mock.isAppActive = false
    expect(renderToStaticMarkup(createElement(UpdateCheckRunner))).toBe('')
    mock.isAppActive = true
    expect(renderToStaticMarkup(createElement(UpdateCheckRunner))).toContain('更新模态框')
    mock.isAppActive = false
    expect(renderToStaticMarkup(createElement(UpdateCheckRunner))).toBe('')
  })
  it('非 Android 平台不显示原生更新模态框', () => {
    mock.supported = false
    mock.isAppActive = true
    expect(renderToStaticMarkup(createElement(UpdateCheckRunner))).toBe('')
    mock.supported = true
  })
})
