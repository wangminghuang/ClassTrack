import { describe, expect, it } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_TIERS } from './constants'
import { SNAP_BACK_DURATION_MS } from './weekSwipe'
import {
  PREVIEW_BLUR_OUT_MS,
  PREVIEW_BLUR_PX,
  REDUCED_MOTION_DURATION_MS,
  SETTLE_DURATION_MS,
  SETTLE_EASING,
  blurFilter,
  clampPreviewScale,
  formatPreviewTransform,
  prefersReducedMotion,
  previewScale,
  previewTransform,
  resolveCommitScrollLeft,
  resolveSettle,
  tierScaleRatio,
} from './zoomPreview'

/** 预览期间出现过的代表性比例：捏开到底 2、捏回到底 0.5、以及中间态。 */
const SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2]

describe('缩放两段式常量', () => {
  it('过渡时长与既有手势动画同一量级，不引入第二套时长口径', () => {
    expect(SETTLE_DURATION_MS).toBe(180)
    expect(Math.abs(SETTLE_DURATION_MS - SNAP_BACK_DURATION_MS)).toBeLessThanOrEqual(60)
    expect(PREVIEW_BLUR_OUT_MS).toBe(120)
    expect(PREVIEW_BLUR_PX).toBe(3)
  })

  it('减少动效时过渡时长必须是 0（不许出现「短一点但仍在播」的中间态）', () => {
    expect(REDUCED_MOTION_DURATION_MS).toBe(0)
  })

  it('缓动是三次贝塞尔字符串，且模糊取值可读', () => {
    expect(SETTLE_EASING.startsWith('cubic-bezier(')).toBe(true)
    expect(blurFilter()).toBe(`blur(${PREVIEW_BLUR_PX}px)`)
    expect(blurFilter(4)).toBe('blur(4px)')
  })
})

describe('预览比例', () => {
  it('把比例夹进 [0.25, 2]，非有限数退回 1', () => {
    expect(clampPreviewScale(1)).toBe(1)
    expect(clampPreviewScale(ZOOM_MIN / ZOOM_MAX)).toBe(ZOOM_MIN / ZOOM_MAX)
    expect(clampPreviewScale(ZOOM_MAX / ZOOM_MIN)).toBe(ZOOM_MAX / ZOOM_MIN)
    expect(clampPreviewScale(ZOOM_MAX / ZOOM_MIN + 1)).toBe(ZOOM_MAX / ZOOM_MIN)
    expect(clampPreviewScale(0.01)).toBe(0.25)
    expect(clampPreviewScale(Number.NaN)).toBe(1)
    expect(clampPreviewScale(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('相对已提交档位换算，非法分母退回 1', () => {
    expect(previewScale(2, 1)).toBe(2)
    expect(previewScale(1, 2)).toBe(0.5)
    expect(previewScale(1.5, 1.5)).toBe(1)
    expect(previewScale(1.8, 1.5)).toBe(1.2)
    expect(previewScale(1, 0)).toBe(1)
    expect(previewScale(1, -1)).toBe(1)
  })

  it('档位两两比例等于档位比值', () => {
    for (const from of ZOOM_TIERS) {
      for (const to of ZOOM_TIERS) {
        expect(tierScaleRatio(from, to)).toBeCloseTo(to / from, 10)
      }
    }

    expect(tierScaleRatio(0, 2)).toBe(1)
  })
})

describe('预览变换', () => {
  it('比例为 1 时不平移', () => {
    for (const centerX of [-200, 0, 137.5, 379]) {
      expect(previewTransform(1, centerX)).toEqual({ translateX: 0, scaleX: 1 })
    }
  })

  it('负中心点与比例为 1 相遇时归一化 -0，样式里不出现 translateX(-0px)', () => {
    const { translateX } = previewTransform(1, -200)

    expect(Object.is(translateX, -0)).toBe(false)
    expect(formatPreviewTransform({ translateX: -0, scaleX: 1 })).toBe('translateX(0px) scaleX(1)')
  })

  it('捏合中心在任何比例下都固定在原地', () => {
    for (const centerX of [0, 40, 189.5, 379]) {
      for (const scale of SCALES) {
        const { translateX, scaleX } = previewTransform(scale, centerX)

        expect(centerX * scaleX + translateX).toBeCloseTo(centerX, 9)
      }
    }
  })

  it('放大时向左平移、缩小时向右平移（单调）', () => {
    const centerX = 200
    let previous = Number.NEGATIVE_INFINITY

    for (const scale of SCALES) {
      const { translateX } = previewTransform(scale, centerX)
      if (scale > 1) expect(translateX).toBeLessThan(0)
      if (scale < 1) expect(translateX).toBeGreaterThan(0)
      previous = Math.max(previous, -translateX)
    }

    expect(previous).toBe(centerX)
  })

  it('拼出的字符串可读且只有两位小数', () => {
    expect(formatPreviewTransform(previewTransform(1.5, 100))).toBe('translateX(-50px) scaleX(1.5)')
    expect(formatPreviewTransform(previewTransform(1.2345, 33))).toBe('translateX(-7.74px) scaleX(1.2345)')
  })
})

describe('落定计划', () => {
  it('正常播放用常量时长；减少动效时长为 0', () => {
    expect(resolveSettle({ targetScale: 1.5, reducedMotion: false })).toEqual({
      durationMs: SETTLE_DURATION_MS,
      easing: SETTLE_EASING,
      targetScale: 1.5,
    })
    expect(resolveSettle({ targetScale: 0.5, reducedMotion: true })).toEqual({
      durationMs: REDUCED_MOTION_DURATION_MS,
      easing: SETTLE_EASING,
      targetScale: 0.5,
    })
  })

  it('落定目标比例同样被夹住，不会把内容压成一条线', () => {
    expect(resolveSettle({ targetScale: 0, reducedMotion: false }).targetScale).toBe(0.25)
  })

  it('比例不变时 scrollLeft 原样保留；放大后捏合中心仍落在同一屏内位置', () => {
    expect(resolveCommitScrollLeft({ scrollLeft: 100, centerX: 50, ratio: 1 })).toBe(100)

    // 手指下的内容点是 scrollLeft + centerX；放大 r 倍后要让它仍然对着 centerX。
    const scrollLeft = 100
    const centerX = 50
    const ratio = 1.5
    const contentPoint = scrollLeft + centerX

    expect(resolveCommitScrollLeft({ scrollLeft, centerX, ratio })).toBe(contentPoint * ratio - centerX)
  })
})

describe('减少动效判定', () => {
  it('非浏览器环境（vitest node / SSR）返回 false，不抛异常', () => {
    expect(typeof window).toBe('undefined')
    expect(prefersReducedMotion()).toBe(false)
  })
})
