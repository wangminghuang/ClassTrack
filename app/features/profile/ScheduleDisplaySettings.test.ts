import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ScheduleDisplaySettings from './ScheduleDisplaySettings'

/** SSR 断言：设置项只读 store 的初始值，node 环境没有 localStorage，因此这里看到的就是默认态。 */
function render() {
  return renderToStaticMarkup(createElement(ScheduleDisplaySettings))
}

describe('课表显示设置：左右边缘滑动切换周', () => {
  it('开关渲染出来、带可访问名、默认开启（AC-1 / AC-2）', () => {
    const html = render()

    expect(html).toContain('id="schedule-display-edge-swipe-week"')
    expect(html).toContain('aria-label="左右边缘滑动切换周"')
    expect(html).toContain('左右边缘滑动切换周')
    expect(html).toContain('data-state="checked"')
  })

  it('说明文案写明「仅手机端」与阻尼松手切周，避免被当成桌面端手势', () => {
    const html = render()

    expect(html).toContain('仅手机端')
    expect(html).toContain('左右边缘')
    expect(html).toContain('松手即切换上一周或下一周')
  })

  it('其余三个显示开关仍在（没有为了塞进新行而挤掉既有设置）', () => {
    const html = render()

    expect(html).toContain('id="schedule-display-out-of-week"')
    expect(html).toContain('id="schedule-display-collapse-empty-days"')
  })

  it('个人中心同时提供原配色与新配色，两套都带八色课程及非本周预览', () => {
    const html = render()

    expect(html).toContain('aria-label="原配色"')
    expect(html).toContain('aria-label="新配色"')
    for (const palette of ['original', 'adjusted']) {
      expect(html.match(new RegExp(`data-palette-sample="${palette}"`, 'g'))).toHaveLength(8)
      expect(html.match(new RegExp(`data-palette-muted-sample="${palette}"`, 'g'))).toHaveLength(8)
    }
    expect(html).toContain('bg-[#84aef7]')
    expect(html).toContain('bg-[#e7a0b3]')
    expect(html).toContain('bg-[#a7cc8a]')
    expect(html).toContain('bg-[#e9a8d2]')
  })
})
