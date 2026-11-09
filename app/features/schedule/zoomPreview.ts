import { ZOOM_MAX, ZOOM_MIN } from './constants'

/**
 * 缩放两段式（合成层预览 → 一次性落定）的**纯函数核**：常量、变换数学与降级判定。
 *
 * 背景（见任务 `10-11-schedule-zoom-jank` 的 `research/README.md`）：真机口径下双指捏合期间
 * 最重长任务 202ms，其中 `overflows()` 的强制布局占 67.3% 采样；把 JS 测量整个冻结之后，
 * 「每帧真实改网格宽度 + 引擎重排」在这套环境里仍只有 ~36fps。只有走合成器属性
 * （`translate` / `scaleX`）才能满帧（实测 84/84 帧、零长任务）。
 *
 * 因此缩放被拆成两段：
 *
 * - **预览**：网格宽度不变，`translateX` / `scaleX` 挂在完整的 `[data-schedule-grid]` 上，
 *   固定的是滚动视口、缩放的是内容；跟手 1:1，不触发布局、不读 DOM；
 * - **落定**：预览比例用一段合成器动画过渡到目标档位比例，动画结束后把真实宽度与
 *   预计算排布一次性落定，并清空变换。
 *
 * 本文件只放「可以脱离 DOM 单测」的部分：所有以像素或比例为输入输出的换算、常量、与
 * 「要不要播动画」的判定。任何需要 DOM 读取的步骤都不属于这里。
 *
 * 单位口径：`scale` 一律是**相对当前已提交档位的比例**（1 = 与已提交档位同宽），
 * 不是绝对缩放值；`centerX` 一律是**完整网格内容坐标**下的 X（含起始滚动偏移）。
 */

/** 缩放两段式的显式状态；`idle` 之外的任何状态都必须带着可被清空的变换。 */
export type ZoomPhase = 'idle' | 'preview' | 'settling'

/**
 * 预览比例的下界。
 *
 * 正常范围是 `[ZOOM_MIN / ZOOM_MAX, ZOOM_MAX / ZOOM_MIN]`（即 0.5 ~ 2）：从 2x 往回收最多收到
 * 1x。留到 0.25 只为防御异常输入（例如指针坐标丢失后算出的比例），避免出现 `scaleX(0)`
 * 把内容压成一条线。
 */
const PREVIEW_SCALE_MIN = 0.25

/** 预览比例的上界：`ZOOM_MAX / ZOOM_MIN`，跟着档位常量走，不另写一份数字。 */
const PREVIEW_SCALE_MAX = ZOOM_MAX / ZOOM_MIN

/** 落定过渡时长。与 `weekSwipe.ts` 的 `SNAP_BACK_DURATION_MS` 同一量级，不引入第二套时长口径。 */
export const SETTLE_DURATION_MS = 180

/** 落定过渡缓动：收尾缓出，让「宽度真正落地那一帧」出现在速度已接近 0 的时候。 */
export const SETTLE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** `prefers-reduced-motion: reduce` 时的过渡时长（R7：不播动画，直接落定）。 */
export const REDUCED_MOTION_DURATION_MS = 0

/** 预览变换的两项；`translateX` 单位是完整网格内容坐标下的 CSS px。 */
export type PreviewTransform = {
  translateX: number
  scaleX: number
}

/**
 * 把任意输入夹到可用的预览比例。
 *
 * @param value 连续缩放算出的比例，可能来自触控坐标相除。
 * @returns 落在 `[PREVIEW_SCALE_MIN, PREVIEW_SCALE_MAX]` 内的比例；非有限数视为 1（不缩放）。
 */
export function clampPreviewScale(value: number): number {
  if (!Number.isFinite(value)) return 1

  return Math.min(Math.max(value, PREVIEW_SCALE_MIN), PREVIEW_SCALE_MAX)
}

/**
 * 由「连续缩放值」与「当前已提交档位」算出预览比例。
 *
 * @param liveZoom 手势过程中的连续缩放值（`clampZoom` 之后的绝对值）。
 * @param committedTier 手势开始前已提交的档位绝对值。
 * @returns 相对已提交档位的比例。
 */
export function previewScale(liveZoom: number, committedTier: number): number {
  if (committedTier <= 0) return 1

  return clampPreviewScale(liveZoom / committedTier)
}

/**
 * 一次内容预览需要的冻结几何。所有 X 都使用完整网格内容坐标，调用方不得在手势中途重读。
 *
 * `startScrollLeft` 只用于把「内容坐标」换算到「视口坐标」，预览期不会真的滚动。
 */
export type PreviewGeometry = {
  scale: number
  centerX: number
  startScrollLeft: number
  contentWidth: number
  viewportWidth: number
}

/**
 * 预览变换：`translateX(tx) scaleX(k)`，先按内容焦点求 `tx`，再按视口覆盖边界钳位。
 *
 * 未触边时 `tx = centerX × (1-k)`：焦点内容点变换后再减冻结的 `startScrollLeft`，仍落在原视口位置。
 * 但缩到左右边缘或最小档位时，固定焦点与「内容铺满视口」不能同时满足，此时覆盖优先：
 *
 * - `tx ≤ startScrollLeft`，保证内容左缘不晚于视口左缘；
 * - `tx ≥ startScrollLeft + viewportWidth - contentWidth × k`，保证内容右缘不早于视口右缘。
 *
 * 正常缩放最小为 1x，因此完整内容总能铺满。异常输入若把内容缩得比视口还窄，则取边界中点居中，
 * 不把不可避免的空缺全推到一侧。调用方必须让网格的 `transform-origin` 为 `0 0`。
 *
 * @param geometry 连续比例与进入手势时冻结的内容/视口几何。
 * @returns 可直接写进完整网格 `transform` 的两项。
 */
export function previewTransform(geometry: PreviewGeometry): PreviewTransform {
  const scaleX = clampPreviewScale(geometry.scale)
  const rawTranslateX = geometry.centerX * (1 - scaleX)
  const minTranslateX = geometry.startScrollLeft + geometry.viewportWidth - geometry.contentWidth * scaleX
  const maxTranslateX = geometry.startScrollLeft
  const translateX =
    minTranslateX <= maxTranslateX ? Math.min(Math.max(rawTranslateX, minTranslateX), maxTranslateX) : (minTranslateX + maxTranslateX) / 2

  // 归一化 -0，避免样式里出现 `translateX(-0px)`，也让「不平移」断言不受浮点零号影响。
  return { translateX: translateX === 0 ? 0 : translateX, scaleX }
}

/**
 * 拼出可写进内联 `transform` 的字符串。
 *
 * `translateX` 取 2 位小数：像素级误差 < 0.01px，同时避免浮点误差把样式字符串撑得很难读。
 *
 * @param transform `previewTransform()` 的结果。
 * @returns 形如 `translateX(-12.34px) scaleX(1.5)` 的字符串。
 */
export function formatPreviewTransform(transform: PreviewTransform): string {
  const rounded = Math.round(transform.translateX * 100) / 100
  const translateX = rounded === 0 ? 0 : rounded

  return `translateX(${translateX}px) scaleX(${transform.scaleX})`
}

/**
 * 目标档位相对起始档位的比例，用作落定动画的目标 `scaleX`。
 *
 * @param fromTier 预览期间冻结的档位（绝对值）。
 * @param toTier 要落定到的档位（绝对值）。
 * @returns 比例；`fromTier` 非法时退回 1。
 */
export function tierScaleRatio(fromTier: number, toTier: number): number {
  if (fromTier <= 0) return 1

  return clampPreviewScale(toTier / fromTier)
}

/**
 * 落定过渡的播放计划（R7：`reducedMotion` 时时长为 0 ⇒ 直接落定）。
 *
 * @param input `targetScale` 为目标比例，`reducedMotion` 来自 `prefersReducedMotion()`。
 * @returns 时长、缓动与目标比例；调用方按时长 0 走「立刻落定」分支。
 */
export function resolveSettle(input: { targetScale: number; reducedMotion: boolean }): {
  durationMs: number
  easing: string
  targetScale: number
} {
  return {
    durationMs: input.reducedMotion ? REDUCED_MOTION_DURATION_MS : SETTLE_DURATION_MS,
    easing: SETTLE_EASING,
    targetScale: clampPreviewScale(input.targetScale),
  }
}

/**
 * 落定时要把 `scrollLeft` 写成什么，才能让捏合中心在「变换被清掉」的瞬间不跳。
 *
 * 与改动前的 `setLiveZoom()` 里那段补偿是同一个式子（那里用连续 `next / previous`，
 * 这里用「目标档位 / 起始档位」），保证两个入口行为一致。
 *
 * @param input `scrollLeft` 是当前滚动位置，`centerX` 是捏合中心相对**滚动容器内容盒**的 X，
 *              `ratio` 是目标档位相对起始档位的比例。
 * @returns 新的 `scrollLeft`。
 */
export function resolveCommitScrollLeft(input: { scrollLeft: number; centerX: number; ratio: number }): number {
  return (input.scrollLeft + input.centerX) * input.ratio - input.centerX
}

/**
 * 是否处于「减少动效」偏好。
 *
 * 与 `useWeekSwipeGesture` 里的内联判定同源（那是本仓库既有的写法）：手势触发时读一次，
 * 不做订阅——不做成 `useSyncExternalStore` 是因为它只在事件回调里被用到，订阅反而会引入
 * 渲染期依赖。非浏览器环境（vitest 的 node 环境、SSR）返回 `false`。
 *
 * @returns 用户是否要求减少动效。
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
