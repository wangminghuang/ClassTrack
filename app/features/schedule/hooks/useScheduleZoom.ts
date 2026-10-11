import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { resumeCellLayout, suspendCellLayout } from '../cellLayout'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_TIERS } from '../constants'
import { clampZoom, getDetailLevel, snapZoomTier } from '../utils'
import { TAP_MOVE_TOLERANCE_PX, isTapSizedMove } from '../weekSwipe'
import {
  PREVIEW_BLUR_OUT_MS,
  PREVIEW_BLUR_PX,
  blurFilter,
  formatPreviewTransform,
  prefersReducedMotion,
  previewScale,
  previewTransform,
  resolveCommitScrollLeft,
  resolveSettle,
  tierScaleRatio,
} from '../zoomPreview'
import type { ZoomPhase } from '../zoomPreview'

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

/**
 * 过渡的收尾工作。
 *
 * 这四样都会在「还没到时候」时被下一次手势或按钮点击打断，因此必须集中登记、统一撤销：
 * 漏掉任何一个，都会在落定后留下一个按老现场执行的闭包。
 */
type ScheduledWork = {
  /** 落定过渡的兜底计时器。 */
  settleTimer: number | null
  /** 落定过渡的 `transitionend` 监听。 */
  settleListener: ((event: TransitionEvent) => void) | null
  /** 模糊淡出的起始帧。 */
  blurFrame: number | null
  /** 模糊淡出结束后的清场计时器。 */
  blurTimer: number | null
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

/**
 * 过渡收尾的兜底余量。
 *
 * `transitionend` 在后台标签页里可能不派发，过渡被同帧的另一处样式写入打断时也不会派发；
 * 超时兜底保证落定一定会发生 —— 多等几十毫秒只影响时序，不影响终态。模糊淡出同理。
 */
const TRANSITION_TIMEOUT_MARGIN_MS = 120

/**
 * 模糊淡出后清场内联样式所用的余量。
 *
 * 比 {@link TRANSITION_TIMEOUT_MARGIN_MS} 小得多：这里的计时器是**主**收尾手段（没有
 * `transitionend` 监听），余量只需要覆盖定时器抖动 —— 即使比过渡早一帧触发也无害，
 * 淡出的终值本来就是 `none`。留太大会让「内联 `transition` 已清空」这个静止态判据
 * 在观感上已经结束之后还继续为假。
 */
const BLUR_CLEANUP_MARGIN_MS = 50

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
 * 手机端课表的缩放走「合成层预览 → 一次性落定」，三条入口（双指 / `−`+ / 双击）共用一个落定实现。
 *
 * **手势期（`preview`）**：整个课表用一层 `scaleX` + 反向平移的合成层跟手，`transform-origin`
 * 落在捏合中心，因此手指下的内容点全程不动。这一段只写样式 —— 不改 `--schedule-zoom`
 * （也就不会触发任何课程格的 `ResizeObserver`）、不读布局，帧代价与课程格内容量无关。
 *
 * 预览层是**近似**的：它等比拉伸的是整个可视窗口，而真实档位只把列宽放大、节次列与字号
 * 都不变，所以节次列附近会有一段最大 `2rem × (k − 1)` 的横向偏差。预览只在手指按住时
 * 存在，落定后立刻由真实排布取代，因此这点偏差不需要（也无法）消除。
 *
 * **落定期（`settling`）**：松手时把连续值吸附到 `ZOOM_TIERS` 之一，合成层再用
 * `SETTLE_DURATION_MS` 的缓动滑到「目标档位 / 起始档位」这个终点比例，过渡结束后交给
 * {@link commit}。`−`/`+` 与双击没有手势阶段，从比例 1 起走同一条路径。
 *
 * **提交（回到 `idle`）**：宽度变更、`scrollLeft` 补偿、收掉变换在同一帧完成 —— 因为
 * `scrollLeft` 的补偿量与合成层的平移量同源（都是「捏合中心不动」），且过渡终点与真实排布的
 * 盒子几何重合，所以这一帧只有格子里的文字在重排，整块课表不会位移。模糊多留一个绘制帧
 * 再淡出，把这一帧的重排盖住（`prefers-reduced-motion: reduce` 时不加模糊、过渡时长为 0，
 * 终态与动画路径逐字节一致）。
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
  /** 当前处在状态机的哪一段（`idle` → `preview` / `settling` → `idle`）。 */
  const phaseRef = useRef<ZoomPhase>('idle')
  /** 过渡的收尾工作，统一登记以便被下一次手势打断。 */
  const workRef = useRef<ScheduledWork>({ settleTimer: null, settleListener: null, blurFrame: null, blurTimer: null })

  const lastToggleRef = useRef(0)

  /**
   * 撤掉所有排队中的过渡收尾工作。
   *
   * 新的手势或按钮点击会打断上一次落定 —— 先把老闭包清掉，它们才不会再按老现场提交。
   */
  const cancelScheduledWork = () => {
    const work = workRef.current
    const stage = zoomStageRef.current
    if (work.settleListener && stage) stage.removeEventListener('transitionend', work.settleListener)
    if (work.settleTimer !== null) clearTimeout(work.settleTimer)
    if (work.blurFrame !== null) cancelAnimationFrame(work.blurFrame)
    if (work.blurTimer !== null) clearTimeout(work.blurTimer)

    workRef.current = { settleTimer: null, settleListener: null, blurFrame: null, blurTimer: null }
  }

  /**
   * 进入 `preview` / `settling` 的共同准备：打断上一次过渡 → 冻结测量 → 打观测锚点 → 按需上模糊。
   *
   * 锚点值就是状态名本身，因此「现在处在哪一段」可以直接从 DOM 读出来（AC3/AC4 的断言点）。
   *
   * @param phase 要进入的状态：`preview`（跟手）或 `settling`（过渡到档位）。
   */
  const enterZoomState = (phase: ZoomPhase) => {
    const stage = zoomStageRef.current
    if (!stage) return

    cancelScheduledWork()
    suspendCellLayout()
    phaseRef.current = phase
    stage.dataset.scheduleZoomPreview = phase
    // 减少动效时不加模糊：模糊同样是为了掩盖形变，属于动效的一部分（R7）。
    if (!prefersReducedMotion()) stage.style.filter = blurFilter(PREVIEW_BLUR_PX)
  }

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
    cancelScheduledWork()
    clearPreviewStyle(zoomStageRef.current)
    gestureRef.current = null
    phaseRef.current = 'idle'
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

    enterZoomState('preview')
    // 跟手就是跟手：预览期不允许任何补间，否则画面会稳定落后手指一帧以上。
    stage.style.transition = 'none'
    renderPreview()
  }

  /**
   * 落定后延迟一个绘制帧再淡出模糊。
   *
   * 落定帧本身要重排（宽度落地），模糊留着正好把那一帧盖住；下一帧才开始淡出，读起来是
   * 「对焦」而不是「闪一下」。淡出结束后把 `filter` / `transition` 一并清掉，回到静止态。
   */
  const scheduleBlurOut = () => {
    const stage = zoomStageRef.current
    if (!stage || !stage.style.filter) return

    workRef.current.blurFrame = window.requestAnimationFrame(() => {
      workRef.current.blurFrame = null
      stage.style.transition = `filter ${PREVIEW_BLUR_OUT_MS}ms linear`
      stage.style.filter = ''
      workRef.current.blurTimer = window.setTimeout(() => {
        workRef.current.blurTimer = null
        stage.style.removeProperty('transition')
        stage.style.removeProperty('filter')
      }, PREVIEW_BLUR_OUT_MS + BLUR_CLEANUP_MARGIN_MS)
    })
  }

  /**
   * 落定：一次性把真实排布换上，并收掉预览。
   *
   * 顺序不能换：先改宽度（写 `--schedule-zoom`）→ 再补 `scrollLeft`（写 `scrollLeft` 会强制
   * 一次排版，必须在宽度变更之后，否则会被旧的滚动范围截断）→ 最后收掉变换。
   *
   * 变换之所以能直接清掉而不跳：过渡的终点比例取「目标档位 / 起始档位」，与真实排布在这一帧
   * 的盒子几何完全重合，屏上只有格子里的文字在重排。模糊留给 `scheduleBlurOut` 淡出。
   *
   * @param tier 目标档位（`ZOOM_TIERS` 之一）。
   */
  const commit = (tier: number) => {
    const gesture = gestureRef.current
    if (!gesture) {
      abortPreview()
      return
    }

    cancelScheduledWork()

    const stage = zoomStageRef.current
    const grid = gridRef.current
    const scroll = scrollRef.current
    const nextScrollLeft = resolveCommitScrollLeft({
      scrollLeft: gesture.startScrollLeft,
      centerX: gesture.scrollCenterX,
      ratio: tierScaleRatio(gesture.committedTier, tier),
    })

    if (grid) grid.style.setProperty('--schedule-zoom', String(tier))
    if (scroll) scroll.scrollLeft = nextScrollLeft

    if (stage) {
      stage.style.removeProperty('transform')
      stage.style.removeProperty('transition')
      delete stage.dataset.scheduleZoomPreview
    }

    gestureRef.current = null
    phaseRef.current = 'idle'
    // 档位与 state 相同时 React 不会重渲染，网格上的内联变量由上面那一次写入负责。
    setZoom(tier)
    resumeCellLayout()
    scheduleBlurOut()
  }

  /**
   * 落定：把合成层从当前比例过渡到目标档位的比例，过渡结束后 {@link commit}。
   *
   * 目标比例取「目标档位 / 起始档位」，因此过渡终点与真实排布的盒子几何重合 —— 落定那一帧
   * 清掉变换时屏上内容不位移，只有格子里的文字重排。
   *
   * @param targetTier 目标档位（`ZOOM_TIERS` 之一）。
   */
  const settleTo = (targetTier: number) => {
    const stage = zoomStageRef.current
    const gesture = gestureRef.current
    if (!stage || !gesture) return

    const { durationMs, easing, targetScale } = resolveSettle({
      targetScale: tierScaleRatio(gesture.committedTier, targetTier),
      reducedMotion: prefersReducedMotion(),
    })
    const fromScale = previewScale(gesture.liveZoom, gesture.committedTier)
    const target = formatPreviewTransform(previewTransform(targetScale, gesture.stageCenterX))

    phaseRef.current = 'settling'
    stage.dataset.scheduleZoomPreview = 'settling'

    // 没有可播的过渡（减少动效、或比例本来就在目标上）：摆到终点直接落定 ——
    // 终态与动画路径逐字节一致，差别只在「有没有那一百八十毫秒」。
    if (durationMs === 0 || targetScale === fromScale) {
      stage.style.transition = 'none'
      stage.style.transform = target
      commit(targetTier)
      return
    }

    const finish = (event: TransitionEvent) => {
      if (event.propertyName !== 'transform') return
      commit(targetTier)
    }
    workRef.current.settleListener = finish
    // 兜底：过渡事件可能不派发（后台标签页、被同帧的另一处样式写入打断），超时直接落定。
    workRef.current.settleTimer = window.setTimeout(() => commit(targetTier), durationMs + TRANSITION_TIMEOUT_MARGIN_MS)
    stage.addEventListener('transitionend', finish)

    // 「同一批写入里设 transition + 改 transform」就会起过渡：起始值是上一帧已生效的样式。
    stage.style.transition = `transform ${durationMs}ms ${easing}`
    stage.style.transform = target
  }

  /**
   * `−` / `+` / 双击的入口。
   *
   * 这三个入口没有捏合阶段，比例从 1 起（中心取整块课表的横向中点），之后与松手落定走
   * **同一条** `settleTo` —— 三条入口只有一个落定实现。
   *
   * @param resolveNext 由当前档位算出目标档位。
   */
  const requestTier = (resolveNext: (current: number) => number) => {
    const stage = zoomStageRef.current
    const scroll = scrollRef.current
    if (!stage || !scroll) return

    const targetTier = resolveNext(zoom)
    // 已经在目标档位、也没有正在播的过渡：无事可做。
    if (targetTier === zoom && phaseRef.current === 'idle') return

    // 打断上一次过渡：把现场重建到「刚刚提交的档位」这个基准上。
    const stageRect = stage.getBoundingClientRect()
    const scrollRect = scroll.getBoundingClientRect()
    gestureRef.current = {
      committedTier: zoom,
      startDistance: 1,
      liveZoom: zoom,
      stageCenterX: stageRect.width / 2,
      scrollCenterX: scrollRect.width / 2,
      startScrollLeft: scroll.scrollLeft,
    }

    enterZoomState('settling')
    settleTo(targetTier)
  }

  const finishGesture = () => {
    const gesture = gestureRef.current
    if (!gesture) return

    settleTo(snapZoomTier(gesture.liveZoom))
  }

  const toggleZoom = () => {
    const now = Date.now()
    if (now - lastToggleRef.current < DOUBLE_TAP_TOGGLE_DEBOUNCE_MS) return

    lastToggleRef.current = now
    requestTier((current) => (current === ZOOM_MIN ? ZOOM_MAX : ZOOM_MIN))
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

  const zoomIn = () => requestTier((current) => ZOOM_TIERS.find((tier) => tier > current) ?? ZOOM_MAX)

  const zoomOut = () =>
    requestTier((current) => {
      const smallerTiers = ZOOM_TIERS.filter((tier) => tier < current)
      return smallerTiers.length > 0 ? smallerTiers[smallerTiers.length - 1] : ZOOM_MIN
    })

  // 手势中途或过渡中离开页面（路由切换、组件卸载）时必须收干净：测量冻结是模块级的，
  // 留下就会让后续所有课程格都永远不再适配；过渡闭包留着则会按老现场提交档位。
  useEffect(
    () => () => {
      cancelScheduledWork()
      clearPreviewStyle(zoomStageRef.current)
      gestureRef.current = null
      phaseRef.current = 'idle'
      resumeCellLayout()
    },
    []
  )
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
