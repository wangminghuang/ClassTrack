import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { resumeCellLayout, setCellLayoutTier, suspendCellLayout } from '../cellLayout'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_TIERS } from '../constants'
import { clampZoom, getDetailLevel, snapZoomTier } from '../utils'
import { TAP_MOVE_TOLERANCE_PX, isTapSizedMove } from '../weekSwipe'
import {
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
  /** 预览焦点：捏合中心在完整网格内容坐标下的 X（含起始滚动偏移）。 */
  contentCenterX: number
  /** 捏合中心相对滚动容器可视区左边缘的 X，落定时补偿 `scrollLeft` 用。 */
  scrollCenterX: number
  /** 进入手势时的 `scrollLeft`；预览期不滚动，落定时直接用它当基准。 */
  startScrollLeft: number
  /** 进入手势时的完整网格布局宽度；变换后的覆盖范围以它为基准。 */
  contentWidth: number
  /** 进入手势时的滚动视口内容宽度；用于边界钳位。 */
  viewportWidth: number
}

/**
 * 过渡的收尾工作。
 *
 * 这两项都会在「还没到时候」时被下一次手势或按钮点击打断，因此必须集中登记、统一撤销：
 * 漏掉任何一个，都会在落定后留下一个按老现场执行的闭包。
 */
type ScheduledWork = {
  /** 落定过渡的兜底计时器。 */
  settleTimer: number | null
  /** 落定过渡的 `transitionend` 监听。 */
  settleListener: ((event: TransitionEvent) => void) | null
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
 * 超时兜底保证落定一定会发生 —— 多等几十毫秒只影响时序，不影响终态。
 */
const TRANSITION_TIMEOUT_MARGIN_MS = 120

function distanceBetween(first: PointerPosition, second: PointerPosition) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

/** 把一次手势冻结的几何交给纯函数核；调用时只换 scale，不重读任何 DOM。 */
function formatGesturePreview(gesture: GestureState, scale: number): string {
  return formatPreviewTransform(
    previewTransform({
      scale,
      centerX: gesture.contentCenterX,
      startScrollLeft: gesture.startScrollLeft,
      contentWidth: gesture.contentWidth,
      viewportWidth: gesture.viewportWidth,
    })
  )
}

/**
 * 收掉预览留在完整网格上的全部内联写法。
 *
 * 静止态必须是「干净」的：网格上的 `transform` / `filter` / `transition` 一样都不许残留，
 * 否则课表会带着一个隐形的合成层继续存在，后续任何改动都在错误的坐标系里发生。
 *
 * @param stage 固定尺寸的裁剪层，只保留缩放相位观测锚点。
 * @param grid 承载预览变换的完整课表内容。
 */
function clearPreviewStyle(stage: HTMLElement | null, grid: HTMLElement | null): void {
  if (stage) delete stage.dataset.scheduleZoomPreview
  if (!grid) return

  grid.style.removeProperty('transform')
  grid.style.removeProperty('filter')
  grid.style.removeProperty('transition')
}

/**
 * 手机端课表的缩放走「合成层预览 → 一次性落定」，三条入口（双指 / `−`+ / 双击）共用一个落定实现。
 *
 * **手势期（`preview`）**：完整课表网格用一层 `scaleX` + 平移的合成层跟手，滚动视口本身固定。
 * `transform-origin` 为左上角，焦点先换算到含 `scrollLeft` 的内容坐标，再按完整内容的覆盖边界钳位。
 * 这一段只写样式 —— 不改 `--schedule-zoom`（也就不会触发任何课程格的 `ResizeObserver`）、不读布局，
 * 帧代价与课程格内容量无关。
 *
 * 预览层是**近似**的：它横向变换的是原档位排布，而真实档位会重新推导列宽与字号。缩到边缘时
 * 优先保证内容覆盖视口，不为了绝对固定焦点留下半屏空白。落定后由真实排布取代，全程不加模糊。
 *
 * **落定期（`settling`）**：松手时把连续值吸附到 `ZOOM_TIERS` 之一，合成层再用
 * `SETTLE_DURATION_MS` 的缓动滑到「目标档位 / 起始档位」这个终点比例，过渡结束后交给
 * {@link commit}。`−`/`+` 与双击没有手势阶段，从比例 1 起走同一条路径。
 *
 * **提交（回到 `idle`）**：宽度变更、清空变换、`scrollLeft` 补偿在同一帧完成 —— 先清预览再写
 * 滚动位置，保证浏览器按目标档位的真实滚动范围钳位。因为预览以完整内容为对象且做了覆盖钳位，
 * 这一帧不会在缩小方向留下半屏空白。`prefers-reduced-motion: reduce` 时过渡时长为 0，终态一致。
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
  const workRef = useRef<ScheduledWork>({ settleTimer: null, settleListener: null })

  const lastToggleRef = useRef(0)

  /**
   * 撤掉所有排队中的过渡收尾工作。
   *
   * 新的手势或按钮点击会打断上一次落定 —— 先把老闭包清掉，它们才不会再按老现场提交。
   */
  const cancelScheduledWork = () => {
    const work = workRef.current
    const grid = gridRef.current
    if (work.settleListener && grid) grid.removeEventListener('transitionend', work.settleListener)
    if (work.settleTimer !== null) clearTimeout(work.settleTimer)

    workRef.current = { settleTimer: null, settleListener: null }
  }

  /**
   * 进入 `preview` / `settling` 的共同准备：打断上一次过渡 → 冻结测量 → 打观测锚点。
   *
   * 锚点值就是状态名本身，因此「现在处在哪一段」可以直接从 DOM 读出来（AC3/AC4 的断言点）。
   * 预览保持文字清晰，不再给整表挂模糊滤镜。
   *
   * @param phase 要进入的状态：`preview`（跟手）或 `settling`（过渡到档位）。
   */
  const enterZoomState = (phase: ZoomPhase) => {
    const stage = zoomStageRef.current
    if (!stage || !gridRef.current) return

    cancelScheduledWork()
    suspendCellLayout()
    phaseRef.current = phase
    stage.dataset.scheduleZoomPreview = phase
  }

  /** 把当前预览比例写进完整网格；只有样式写入，没有布局读取。 */
  const renderPreview = () => {
    const grid = gridRef.current
    const gesture = gestureRef.current
    if (!grid || !gesture) return

    const scale = previewScale(gesture.liveZoom, gesture.committedTier)
    grid.style.transform = formatGesturePreview(gesture, scale)
  }

  /** 中止预览：不改档位、不改宽度，直接回到静止态（异常指针序列会走这里）。 */
  const abortPreview = () => {
    cancelScheduledWork()
    clearPreviewStyle(zoomStageRef.current, gridRef.current)
    gestureRef.current = null
    phaseRef.current = 'idle'
    resumeCellLayout()
  }

  /** 进入预览：读一次完整内容与视口几何 → 冻结测量 → 挂上观测锚点。 */
  const beginPreview = (first: PointerPosition, second: PointerPosition) => {
    const stage = zoomStageRef.current
    const scroll = scrollRef.current
    const grid = gridRef.current
    if (!stage || !scroll || !grid) return

    // 整个手势只在这里读布局。
    const scrollRect = scroll.getBoundingClientRect()
    const startScrollLeft = scroll.scrollLeft
    const centerClientX = (first.x + second.x) / 2
    const scrollCenterX = centerClientX - scrollRect.left - scroll.clientLeft

    gestureRef.current = {
      committedTier: zoom,
      startDistance: Math.max(distanceBetween(first, second), 1),
      liveZoom: zoom,
      contentCenterX: startScrollLeft + scrollCenterX,
      scrollCenterX,
      startScrollLeft,
      contentWidth: grid.offsetWidth,
      viewportWidth: scroll.clientWidth,
    }

    enterZoomState('preview')
    // 跟手就是跟手：预览期不允许任何补间，否则画面会稳定落后手指一帧以上。
    grid.style.transition = 'none'
    renderPreview()
  }

  /**
   * 落定：一次性把真实排布换上，并收掉预览。
   *
   * 顺序不能换：先声明档位（`setCellLayoutTier`，本帧末到来的 `ResizeObserver` 回声要靠它命中
   * 预计算缓存）→ 再改宽度 → 清掉预览变换 → 最后补 `scrollLeft`。先清变换再写滚动位置，
   * 保证浏览器按目标档位的真实滚动范围钳位，而不是按临时预览的视觉溢出范围钳位。
   *
   * 这些写入在同一个任务里完成，不会把中间态画到屏上。真实内容直接以清晰排布出现，不再用模糊遮盖。
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
    // 档位必须在同一个任务里先声明：回声到达时队列已经需要它才能命中缓存。
    setCellLayoutTier(tier)
    if (grid) grid.style.setProperty('--schedule-zoom', String(tier))
    clearPreviewStyle(stage, grid)
    if (scroll) scroll.scrollLeft = nextScrollLeft

    gestureRef.current = null
    phaseRef.current = 'idle'
    // 档位与 state 相同时 React 不会重渲染，网格上的内联变量由上面那一次写入负责。
    setZoom(tier)
    resumeCellLayout()
  }

  /**
   * 落定：把完整网格从当前比例过渡到目标档位的比例，过渡结束后 {@link commit}。
   *
   * 起止点都经过同一套覆盖钳位；由于边界随 scale 线性变化，同一缓动插值出的中间帧也保持覆盖。
   *
   * @param targetTier 目标档位（`ZOOM_TIERS` 之一）。
   */
  const settleTo = (targetTier: number) => {
    const stage = zoomStageRef.current
    const grid = gridRef.current
    const gesture = gestureRef.current
    if (!stage || !grid || !gesture) return

    const { durationMs, easing, targetScale } = resolveSettle({
      targetScale: tierScaleRatio(gesture.committedTier, targetTier),
      reducedMotion: prefersReducedMotion(),
    })
    const fromScale = previewScale(gesture.liveZoom, gesture.committedTier)
    const target = formatGesturePreview(gesture, targetScale)

    phaseRef.current = 'settling'
    stage.dataset.scheduleZoomPreview = 'settling'

    // 没有可播的过渡（减少动效、或比例本来就在目标上）：摆到终点直接落定。
    if (durationMs === 0 || targetScale === fromScale) {
      grid.style.transition = 'none'
      grid.style.transform = target
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
    grid.addEventListener('transitionend', finish)

    // 「同一批写入里设 transition + 改 transform」就会起过渡：起始值是上一帧已生效的样式。
    grid.style.transition = `transform ${durationMs}ms ${easing}`
    grid.style.transform = target
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
    const grid = gridRef.current
    if (!stage || !scroll || !grid) return

    const targetTier = resolveNext(zoom)
    // 已经在目标档位、也没有正在播的过渡：无事可做。
    if (targetTier === zoom && phaseRef.current === 'idle') return

    // 打断上一次过渡：把现场重建到「刚刚提交的档位」这个基准上。
    const startScrollLeft = scroll.scrollLeft
    const scrollCenterX = scroll.clientWidth / 2
    gestureRef.current = {
      committedTier: zoom,
      startDistance: 1,
      liveZoom: zoom,
      contentCenterX: startScrollLeft + scrollCenterX,
      scrollCenterX,
      startScrollLeft,
      contentWidth: grid.offsetWidth,
      viewportWidth: scroll.clientWidth,
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
      clearPreviewStyle(zoomStageRef.current, gridRef.current)
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
