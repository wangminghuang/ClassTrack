import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { resumeCellLayout, suspendCellLayout } from '../cellLayout'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_TIERS } from '../constants'
import { clampZoom, getDetailLevel, snapZoomTier } from '../utils'
import { TAP_MOVE_TOLERANCE_PX, isTapSizedMove } from '../weekSwipe'
import {
  PREVIEW_BLUR_PX,
  blurFilter,
  formatPreviewTransform,
  previewScale,
  previewTransform,
  resolveCommitScrollLeft,
  tierScaleRatio,
} from '../zoomPreview'

type PointerPosition = {
  x: number
  y: number
  /** 按下点：只用于「这次抬起算不算点按」，不随移动更新。 */
  downX: number
  downY: number
}

/**
 * 双指手势的现场。
 *
 * 这里面的几何量全部在**进入手势时读一次**，之后整个手势复用：手势期每帧读一次布局
 * （`getBoundingClientRect` / `scrollHeight`）都会强制排版，正是要消灭的开销来源。
 */
type GestureState = {
  /** 进入双指手势时的已提交档位：预览比例与落定比例都以它为基准。 */
  committedTier: number
  /** 进入双指手势时两指的间距，作为缩放比例的分母。 */
  startDistance: number
  /** 手势过程中最新的连续缩放值，松手时用来吸附档位。 */
  liveZoom: number
  /** 预览变换的原点：捏合中心在合成层局部坐标下的 X。 */
  stageCenterX: number
  /** 捏合中心相对滚动容器可视区左边缘的 X，落定时补偿 `scrollLeft` 用。 */
  scrollCenterX: number
  /** 进入手势时的 `scrollLeft`；预览期不滚动，落定时直接用它当基准。 */
  startScrollLeft: number
}

/** 触摸端双击判定的最大间隔。 */
const DOUBLE_TAP_INTERVAL_MS = 320

/**
 * 双击切换的去抖窗口。
 *
 * 同一次双击在真机上会走两条路径：我们自己的两次 `pointerup` 判定，以及浏览器在第二次
 * 抬起后合成的 `dblclick`（Android WebView 实测会派发）。两条都触发就会切换两次、
 * 相互抵消，因此在窗口内只允许切换一次。
 */
const DOUBLE_TAP_TOGGLE_DEBOUNCE_MS = 400

function distanceBetween(first: PointerPosition, second: PointerPosition) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

/**
 * 收掉预览留在合成层上的全部内联写法。
 *
 * 静止态必须是「干净」的：`transform` / `filter` / `transition` 三样一个都不许残留，
 * 否则课表会带着一个隐形的合成层继续存在，后续任何改动都在错误的坐标系里发生。
 *
 * @param stage 承载预览变换的合成层，即 `[data-schedule-zoom-stage]` 那个手势裁剪层。
 */
function clearPreviewStyle(stage: HTMLElement | null): void {
  if (!stage) return

  stage.style.removeProperty('transform')
  stage.style.removeProperty('filter')
  stage.style.removeProperty('transition')
  delete stage.dataset.scheduleZoomPreview
}

/**
 * 手机端课表的双指缩放，分两段走。
 *
 * **手势期（预览）**：整个课表用一层 `scaleX` + 反向平移的合成层跟手，`transform-origin`
 * 落在捏合中心，因此手指下的内容点全程不动。这一段只写样式 —— 不改 `--schedule-zoom`
 * （也就不会触发任何课程格的 `ResizeObserver`）、不读布局，帧代价与课程格内容量无关。
 *
 * 预览层是**近似**的：它等比拉伸的是整个可视窗口，而真实档位只把列宽放大、节次列与字号
 * 都不变，所以节次列附近会有一段最大 `2rem × (k − 1)` 的横向偏差。预览只在手指按住时
 * 存在，落定后立刻由真实排布取代，因此这点偏差不需要（也无法）消除。
 *
 * **落定期**：手指抬起时把连续值吸附到 `ZOOM_TIERS` 之一，宽度变更、`scrollLeft` 补偿、
 * 预览样式收掉全部在同一帧完成 —— 因为 `scrollLeft` 的补偿量与预览层的平移量同源
 * （都是「捏合中心不动」），所以落定这一帧只有格子里的文字重排，整块课表不会位移。
 *
 * @returns 已提交档位、信息分级、三个 DOM 引用、需要挂到滚动容器上的事件处理器，
 * 以及给 −/+ 按钮与双击使用的档位操作。
 */
export function useScheduleZoom() {
  const [zoom, setZoom] = useState<number>(ZOOM_MIN)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const zoomStageRef = useRef<HTMLDivElement | null>(null)
  const pointersRef = useRef(new Map<number, PointerPosition>())
  const gestureRef = useRef<GestureState | null>(null)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)

  const lastToggleRef = useRef(0)

  // 手势中途离开页面（路由切换、组件卸载）时必须放开测量冻结：它是模块级的，留下就会
  // 让后续所有课程格都永远不再适配。
  useEffect(
    () => () => {
      clearPreviewStyle(zoomStageRef.current)
      gestureRef.current = null
      resumeCellLayout()
    },
    []
  )

  /** 把当前预览比例写进合成层；只有样式写入，没有布局读取。 */
  const renderPreview = () => {
    const stage = zoomStageRef.current
    const gesture = gestureRef.current
    if (!stage || !gesture) return

    const scale = previewScale(gesture.liveZoom, gesture.committedTier)
    stage.style.transform = formatPreviewTransform(previewTransform(scale, gesture.stageCenterX))
  }

  /** 中止预览：不改档位、不改宽度，直接回到静止态（异常指针序列会走这里）。 */
  const abortPreview = () => {
    clearPreviewStyle(zoomStageRef.current)
    gestureRef.current = null
    resumeCellLayout()
  }

  /** 进入预览：读一次几何 → 冻结测量 → 挂上模糊与观测锚点。 */
  const beginPreview = (first: PointerPosition, second: PointerPosition) => {
    const stage = zoomStageRef.current
    const scroll = scrollRef.current
    if (!stage || !scroll) return

    // 整个手势只在这里读布局。
    const stageRect = stage.getBoundingClientRect()
    const scrollRect = scroll.getBoundingClientRect()
    const centerClientX = (first.x + second.x) / 2

    gestureRef.current = {
      committedTier: zoom,
      startDistance: Math.max(distanceBetween(first, second), 1),
      liveZoom: zoom,
      stageCenterX: centerClientX - stageRect.left,
      scrollCenterX: centerClientX - scrollRect.left,
      startScrollLeft: scroll.scrollLeft,
    }

    suspendCellLayout()
    stage.dataset.scheduleZoomPreview = 'preview'
    // 跟手就是跟手：预览期不允许任何补间，否则画面会稳定落后手指一帧以上。
    stage.style.transition = 'none'
    // 拉伸后的字会把「排布还没换过来」暴露得很明显，模糊把它盖住（用户确认过的取舍）。
    stage.style.filter = blurFilter(PREVIEW_BLUR_PX)
    renderPreview()
  }

  /**
   * 预览结束，一次性落定到某个档位。
   *
   * 顺序不能换：先改宽度（写 `--schedule-zoom`）→ 再补 `scrollLeft`（写 `scrollLeft` 会
   * 强制一次排版，必须在宽度变更之后，否则会被旧的滚动范围截断）→ 最后收掉预览样式。
   * 落定不需要读任何布局：`scrollLeft` 用进入手势时记下的值。
   *
   * @param tier 目标档位（`ZOOM_TIERS` 之一）。
   */
  const commit = (tier: number) => {
    const gesture = gestureRef.current
    if (!gesture) {
      abortPreview()
      return
    }

    const grid = gridRef.current
    const scroll = scrollRef.current
    const nextScrollLeft = resolveCommitScrollLeft({
      scrollLeft: gesture.startScrollLeft,
      centerX: gesture.scrollCenterX,
      ratio: tierScaleRatio(gesture.committedTier, tier),
    })

    if (grid) grid.style.setProperty('--schedule-zoom', String(tier))
    if (scroll) scroll.scrollLeft = nextScrollLeft
    clearPreviewStyle(zoomStageRef.current)

    gestureRef.current = null
    // 档位与 state 相同时 React 不会重渲染，网格上的内联变量由上面那一次写入负责。
    setZoom(tier)
    resumeCellLayout()
  }

  const finishGesture = () => {
    const gesture = gestureRef.current
    if (!gesture) return

    commit(snapZoomTier(gesture.liveZoom))
  }

  const toggleZoom = () => {
    const now = Date.now()
    if (now - lastToggleRef.current < DOUBLE_TAP_TOGGLE_DEBOUNCE_MS) return

    lastToggleRef.current = now
    setZoom((current) => (current === ZOOM_MIN ? ZOOM_MAX : ZOOM_MIN))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 同时记下按下点：抬起时要靠它判断「这次抬起算不算点按」（`downX`/`downY` 不随移动更新）。
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      downX: event.clientX,
      downY: event.clientY,
    })

    if (pointersRef.current.size !== 2) return

    const [first, second] = [...pointersRef.current.values()]
    beginPreview(first, second)

    // 双指期间把两个 pointer 都捕获到容器上，避免手指移出课表区域时丢事件。
    // 合成的 pointer 事件（自动化断言）没有真实指针，捕获会抛异常，不影响手势本身。
    pointersRef.current.forEach((_, pointerId) => {
      try {
        event.currentTarget.setPointerCapture(pointerId)
      } catch {
        // 忽略无法捕获的 pointer：真实触摸不会走到这里
      }
    })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointersRef.current.get(event.pointerId)
    const gesture = gestureRef.current
    if (!pointer || !gesture) return

    pointer.x = event.clientX
    pointer.y = event.clientY

    if (pointersRef.current.size < 2) return

    // WebView 默认会在双指拖动时同时平移，这里显式取消原生行为。
    if (event.pointerType === 'touch') event.preventDefault()

    const [first, second] = [...pointersRef.current.values()]
    gesture.liveZoom = clampZoom((gesture.committedTier * distanceBetween(first, second)) / gesture.startDistance)
    renderPreview()
  }

  /**
   * 结束一个指针。
   *
   * `allowTap` 只在真正的 `pointerup` 上为真：触摸横向拖动时浏览器会发 `pointercancel`
   * （即使该方向根本不能滚动也会发），它的坐标离按下点只有几 px —— 若参与双击判定，
   * 连续两次横滑就会被误判成双击、缩放档位被来回切换。
   */
  const endPointer = (event: ReactPointerEvent<HTMLDivElement>, allowTap: boolean) => {
    const pointer = pointersRef.current.get(event.pointerId)
    pointersRef.current.delete(event.pointerId)

    if (gestureRef.current) {
      if (pointersRef.current.size < 2) finishGesture()
      return
    }

    // 双指手势之外的单指抬起：可能是触摸端的双击（WebView 不一定派发 dblclick）。
    if (!allowTap || !pointer || event.pointerType !== 'touch') return

    // 已经拖出去几十 px 的手势不是点按：按下点到抬起点的位移必须还在容差内。
    if (!isTapSizedMove(pointer.downX, pointer.downY, event.clientX, event.clientY)) {
      lastTapRef.current = null
      return
    }

    const now = Date.now()
    const lastTap = lastTapRef.current
    lastTapRef.current = { time: now, x: event.clientX, y: event.clientY }

    const isDoubleTap =
      lastTap !== null &&
      now - lastTap.time < DOUBLE_TAP_INTERVAL_MS &&
      Math.abs(event.clientX - lastTap.x) < TAP_MOVE_TOLERANCE_PX &&
      Math.abs(event.clientY - lastTap.y) < TAP_MOVE_TOLERANCE_PX

    if (!isDoubleTap) return

    lastTapRef.current = null
    toggleZoom()
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => endPointer(event, true)

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => endPointer(event, false)

  const zoomIn = () => setZoom((current) => ZOOM_TIERS.find((tier) => tier > current) ?? ZOOM_MAX)

  const zoomOut = () =>
    setZoom((current) => {
      const smallerTiers = ZOOM_TIERS.filter((tier) => tier < current)
      return smallerTiers.length > 0 ? smallerTiers[smallerTiers.length - 1] : ZOOM_MIN
    })

  return {
    zoom,
    detailLevel: getDetailLevel(zoom),
    scrollRef,
    gridRef,
    zoomStageRef,
    containerProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      // cancel 只做记账（见 `endPointer` 的注释）：它不能参与双击判定。
      onPointerCancel: handlePointerCancel,
      onDoubleClick: toggleZoom,
    },
    zoomIn,
    zoomOut,
    canZoomIn: zoom < ZOOM_MAX,
    canZoomOut: zoom > ZOOM_MIN,
  }
}
