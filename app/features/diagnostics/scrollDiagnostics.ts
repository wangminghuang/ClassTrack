/**
 * 课表滚动诊断（诊断包专用，来源任务 `10-10-schedule-scroll-device-rootcause`）。
 *
 * 为什么需要它：用户真机上「课表主体单指也滑不动」，但本机可跑的引擎（WebView 91 / 120 / 149）里
 * 要么整页空白、要么单指滚动完全正常，**复现不到**；用户又暂时拿不到 WebView 版本、无法连 USB。
 * 因此把「读数」做成随包下发的浮层：用户装一次、滑两次、截一张图，就能把判定根因所需的量取回来。
 *
 * 设计约束（见任务 `design.md` R3）：
 * - 采集函数只**读**不写：不改 `touch-action`、不改任何高度，监听一律 `{ passive: true }`；
 * - 依赖注入 `win` / `doc`，因此纯逻辑可在 node 环境用桩对象做单测（本仓库 vitest 的 `environment: 'node'`）；
 * - 判定与采集分离：`verdictHints` 只吃快照，便于按任务 `design.md` §2.4 的判定表逐行覆盖。
 */

/** 诊断浮层的开关参数名。 */
export const DIAG_PARAM = 'diag'
/** 诊断浮层的开关参数值：`?diag=schedule-scroll`。 */
export const DIAG_VALUE = 'schedule-scroll'
/** 课表滚动容器（`ScheduleTable.tsx` 上的测试挂钩）。 */
export const SCHEDULE_SCROLLER_SELECTOR = '[data-schedule-scroll]'
/** 课表网格（同上）。 */
export const SCHEDULE_GRID_SELECTOR = '[data-schedule-grid]'
/** 课表滑动舞台（承接横滑切周与裁剪的那一层）。 */
export const SCHEDULE_STAGE_SELECTOR = '[data-schedule-swipe-stage]'
/** 当前周次读数所在节点。 */
export const CURRENT_WEEK_SELECTOR = '[data-current-week]'

/** 判定表里的结论标识（值即标识，便于在读数里直接读出来）。 */
export const DIAGNOSIS = {
  /** 引擎能力低于基线（`oklch` / `@layer` 任一不支持）。 */
  engineBelowBaseline: 'ENGINE_BELOW_BASELINE',
  /** 当前页面没有课表（在设置页取数时应出现这一条）。 */
  noScheduleOnPage: 'NO_SCHEDULE_ON_PAGE',
  /** 单指拖动期间出现了 2 个及以上触点 ⇒ 指向 `touch-action: pan-x_pan-y` 的多触点缺陷。 */
  multiTouchContact: 'MULTI_TOUCH_CONTACT',
  /** 容器没有可滚动距离，且存在裁掉内容的祖先 ⇒ 高度链塌陷。 */
  heightChainCollapse: 'HEIGHT_CHAIN_COLLAPSE',
  /** 容器没有可滚动距离，也没有裁内容的祖先 ⇒ 内容本来就装得下（不是缺陷）。 */
  /** 还没记录到拖动 ⇒ 先让用户滑两次再冻结读数。 */
  noDragRecorded: 'NO_DRAG_RECORDED',
  contentFits: 'CONTENT_FITS',
  /**
   * 网格行明明溢出了自身盒子，滚动容器却认为没有可滚内容（或可滚距离不够）
   * ⇒ 行溢出没被计入祖先滚动区。真机实测（Android WebView 120 / API 32）：
   * `[data-schedule-scroll]` scrollH == clientH == 510，而 `[data-schedule-grid]` 是 510/780。
   */
  gridOverflowNotScrollable: 'GRID_OVERFLOW_NOT_SCROLLABLE',
  /** 有可滚动距离但拖动后 `scrollTop` 不动、也没有 scroll 事件 ⇒ 滚动被吞。 */
  scrollSwallowed: 'SCROLL_SWALLOWED',
  /** 拖了很远却只滚了一点点 ⇒ 滚动被裁切层/尺寸分配吃掉一部分。 */
  clippedByStage: 'CLIPPED_BY_STAGE',
  /** 滚动跟得上手指（或已到底）⇒ 该容器滚动正常。 */
  scrollOk: 'SCROLL_OK',
} as const

export type DiagnosisCode = (typeof DIAGNOSIS)[keyof typeof DIAGNOSIS]

/** 计算样式中与高度链/手势相关的字段（只取需要的，避免把整份样式打进读数）。 */
export type DiagnosticComputedStyle = {
  height: string
  minHeight: string
  overflowY: string
  display: string
  flex: string
  transform: string
  touchAction: string
  getPropertyValue?(name: string): string
}

/** 采集所需的最小元素接口（真实 `Element` 结构上兼容，测试可传桩）。 */
export type DiagnosticElement = {
  tagName: string
  className?: unknown
  parentElement: DiagnosticElement | null
  getAttribute?(name: string): string | null
  clientHeight?: number
  clientWidth?: number
  scrollHeight?: number
  scrollWidth?: number
  scrollTop?: number
  scrollLeft?: number
}

/** 采集所需的最小文档接口。 */
export type DiagnosticDocument = {
  documentElement: DiagnosticElement | null
  body: DiagnosticElement | null
  querySelector(selector: string): DiagnosticElement | null
  querySelectorAll(selector: string): ArrayLike<DiagnosticElement>
}

/** 采集所需的最小 window 接口。 */
export type DiagnosticWindow = {
  innerWidth: number
  innerHeight: number
  devicePixelRatio: number
  getComputedStyle(element: DiagnosticElement): DiagnosticComputedStyle
  visualViewport?: { scale: number } | null
  CSS?: { supports(property: string, value: string): boolean }
  location?: { href: string }
  navigator?: { userAgent: string }
}

/** 事件计数所需的最小 window 接口（真实 `Window` 结构上兼容）。 */
export type GestureWindow = {
  addEventListener(type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void
  removeEventListener(type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void
}

/** 链上单个节点的读数。 */
export type ChainNodeReading = {
  /** `div` / `main` / `body` 之类，便于人工核对。 */
  tag: string
  /** `data-slot`，例如 `sidebar-inset`（不是每个节点都有）。 */
  slot: string | null
  /** 截断后的 class 列表，用来认出 `.app-viewport` 这类锚点。 */
  cls: string
  height: string
  minHeight: string
  overflowY: string
  display: string
  flex: string
  transform: string
  touchAction: string
  clientH: number
  scrollH: number
  /** 自身有纵向可滚动距离。 */
  scrollable: boolean
  /** `overflow-y` 是 hidden/clip 且自身可滚动内容比可视区高 ⇒ 会裁掉内容。 */
  clipsContent: boolean
}

/** 手势计数（`maxTouches` 是判定「单指被识别成多触点」的关键量）。 */
export type GestureCounters = {
  touchStart: number
  touchMove: number
  touchEnd: number
  pointerDown: number
  pointerMove: number
  scroll: number
  maxTouches: number
  maxPointerIds: number
  /** 本次手势的竖直位移峰值（CSS px）；用来判断「滚动有没有跟得上手指」。 */
  maxDragDy: number
}

/** 一次手势前后的 `scrollTop` 读数。 */
export type GestureScrollReading = {
  scrollTopBefore: number | null
  scrollTopAfter: number | null
}

/** 完整诊断快照。 */
export type ScrollDiagnosticsSnapshot = {
  /** 采集时间（本地 ISO 串，便于用户描述「哪一次滑动」）。 */
  capturedAt: string
  href: string
  env: {
    userAgent: string
    innerW: number
    innerH: number
    dpr: number
    visualScale: number | null
  }
  caps: {
    dvh: boolean
    svh: boolean
    oklch: boolean
    layer: boolean
    /** `html` 的计算高度是否等于视口高度（视口单位真的生效了）。 */
    rootHeightMatchesViewport: boolean
    rootHeight: string
  }
  scroller: ChainNodeReading | null
  /** `scrollHeight - clientHeight`；没有课表时为 null。 */
  scrollerMaxScrollTop: number | null
  scrollTopNow: number | null
  /** 从滚动容器自身往上到 `html` 的链。 */
  chain: ChainNodeReading[]
  /** 链上会裁掉内容的祖先（判定高度链塌陷用）。 */
  clippingAncestors: ChainNodeReading[]
  /** 本页可滚动容器（跨页对照：设置页应能读到，课表页也能读到）。 */
  pageScroller: ChainNodeReading | null
  grid: {
    found: boolean
    clientH: number
    scrollH: number
    /** `--schedule-zoom` 的当前值（应用内缩放）。 */
    zoom: string | null
    currentWeek: string | null
    swipeState: string | null
  }
  gesture: GestureCounters
  gestureScroll: GestureScrollReading
  diagnosis: DiagnosisCode[]
}

const MAX_CLASS_CHARS = 140
const VIEWPORT_TOLERANCE_PX = 2

function readClassName(element: DiagnosticElement): string {
  const raw = element.className
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && 'baseVal' in raw) {
    const baseVal = (raw as { baseVal?: unknown }).baseVal
    if (typeof baseVal === 'string') return baseVal
  }
  return ''
}

function readSlot(element: DiagnosticElement): string | null {
  return element.getAttribute ? element.getAttribute('data-slot') : null
}

function readNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 读自定义属性（例如 `--schedule-zoom`）；引擎/桩对象没有该方法时按「读不到」处理。 */
function readCustomProperty(win: DiagnosticWindow, element: DiagnosticElement | null, name: string): string | null {
  if (!element) return null
  const value = win.getComputedStyle(element).getPropertyValue?.(name)?.trim()
  return value ? value : null
}

/** 读一个节点的计算样式 + 尺寸，并算出「能否滚动 / 会不会裁内容」。 */
export function captureNode(win: DiagnosticWindow, element: DiagnosticElement): ChainNodeReading {
  const style = win.getComputedStyle(element)
  const clientH = readNumber(element.clientHeight)
  const scrollH = readNumber(element.scrollHeight)
  const overflowY = style.overflowY
  const clips = (overflowY === 'hidden' || overflowY === 'clip') && clientH + 1 < scrollH
  return {
    tag: element.tagName.toLowerCase(),
    slot: readSlot(element),
    cls: readClassName(element).slice(0, MAX_CLASS_CHARS),
    height: style.height,
    minHeight: style.minHeight,
    overflowY,
    display: style.display,
    flex: style.flex,
    transform: style.transform,
    touchAction: style.touchAction,
    clientH,
    scrollH,
    scrollable: scrollH > clientH + 1,
    clipsContent: clips,
  }
}

function readAncestorChain(win: DiagnosticWindow, element: DiagnosticElement | null): ChainNodeReading[] {
  const chain: ChainNodeReading[] = []
  let cursor: DiagnosticElement | null = element
  let guard = 0
  while (cursor && guard < 64) {
    chain.push(captureNode(win, cursor))
    cursor = cursor.parentElement
    guard += 1
  }
  return chain
}

function isInsideDiagnosticsOverlay(element: DiagnosticElement): boolean {
  let cursor: DiagnosticElement | null = element
  let guard = 0
  while (cursor && guard < 64) {
    if (cursor.getAttribute?.('data-diag-ignore') === 'true') return true
    cursor = cursor.parentElement
    guard += 1
  }
  return false
}

/** 找本页第一个「有纵向可滚动距离」的普通容器，用来做跨页对照（排除诊断浮层自身）。 */
function findPageScroller(win: DiagnosticWindow, doc: DiagnosticDocument): ChainNodeReading | null {
  const candidates = doc.querySelectorAll('div, main, section, ul')
  for (let index = 0; index < candidates.length; index += 1) {
    const element = candidates[index]
    const tag = element.tagName.toLowerCase()
    if (tag === 'textarea' || isInsideDiagnosticsOverlay(element)) continue
    const style = win.getComputedStyle(element)
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
    if (readNumber(element.scrollHeight) <= readNumber(element.clientHeight) + 1) continue
    return captureNode(win, element)
  }
  return null
}

function readCapability(win: DiagnosticWindow, property: string, value: string): boolean {
  if (!win.CSS || typeof win.CSS.supports !== 'function') return false
  try {
    return win.CSS.supports(property, value)
  } catch {
    return false
  }
}

/** 滚动位移 / 拖动位移的比值达到它，就算「滚动跟得上手指」。 */
const SCROLL_FOLLOW_RATIO = 0.5
/** 小于这个竖直位移（CSS px）不算一次有效拖动，避免点按被当成拖动。 */
const MIN_MEANINGFUL_DRAG_PX = 8

/** 按 `design.md` §2.4 的判定表给出结论标识（纯函数，可单测）。 */
export function verdictHints(
  snapshot: Pick<
    ScrollDiagnosticsSnapshot,
    'scroller' | 'scrollerMaxScrollTop' | 'clippingAncestors' | 'gesture' | 'gestureScroll' | 'caps' | 'grid'
  >
): DiagnosisCode[] {
  const hints: DiagnosisCode[] = []
  if (!snapshot.caps.oklch || !snapshot.caps.layer) hints.push(DIAGNOSIS.engineBelowBaseline)

  const scroller = snapshot.scroller
  if (!scroller) {
    hints.push(DIAGNOSIS.noScheduleOnPage)
    return hints
  }

  const maxScrollTop = snapshot.scrollerMaxScrollTop ?? 0
  const { gesture, gestureScroll } = snapshot
  const dragged = gesture.touchMove > 0 || gesture.pointerMove > 0
  const before = gestureScroll.scrollTopBefore
  const after = gestureScroll.scrollTopAfter
  const moved = before !== null && after !== null ? after - before : 0

  if (gesture.maxTouches >= 2) hints.push(DIAGNOSIS.multiTouchContact)

  // 网格行溢出了自身盒子，却没变成祖先的可滚距离 ⇒ 行溢出没传导到滚动区
  // （Android WebView 120 实测：网格 510/780，滚动容器 510/510）。这条优先于 CONTENT_FITS，
  // 否则会把「滚不到的第 9~12 节」误判成「内容本来就装得下」。
  const gridOverflow = snapshot.grid.found ? snapshot.grid.scrollH - snapshot.grid.clientH : 0
  if (gridOverflow > Math.max(0, maxScrollTop) + 1) {
    hints.push(DIAGNOSIS.gridOverflowNotScrollable)
    return hints
  }

  if (maxScrollTop <= 0) {
    hints.push(snapshot.clippingAncestors.length > 0 ? DIAGNOSIS.heightChainCollapse : DIAGNOSIS.contentFits)
    return hints
  }

  if (!dragged) {
    hints.push(DIAGNOSIS.noDragRecorded)
    return hints
  }

  if (moved <= 0 && gesture.scroll === 0) {
    hints.push(DIAGNOSIS.scrollSwallowed)
    return hints
  }

  // 「滚动正常」的标准不是「滚到底」，而是**滚动跟得上手指**：一次 140px 的拖动滚到一半就停，
  // 在真机上同样是正常滚动（用户只是没滑到底）。只有「拖了很远、滚动几乎不动」才另有问题。
  const reachedBottom = after !== null && after + 1 >= maxScrollTop
  const followRatio = gesture.maxDragDy >= MIN_MEANINGFUL_DRAG_PX ? moved / gesture.maxDragDy : null

  if (reachedBottom || followRatio === null || followRatio >= SCROLL_FOLLOW_RATIO) hints.push(DIAGNOSIS.scrollOk)
  else hints.push(DIAGNOSIS.clippedByStage)
  return hints
}

/** 采集一次完整快照。`gesture` / `gestureScroll` 由 `createGestureRecorder` 提供（可选）。 */
export function collectScrollDiagnostics(
  win: DiagnosticWindow,
  doc: DiagnosticDocument,
  observed?: { gesture?: GestureCounters; gestureScroll?: GestureScrollReading }
): ScrollDiagnosticsSnapshot {
  const scrollerElement = doc.querySelector(SCHEDULE_SCROLLER_SELECTOR)
  const chain = readAncestorChain(win, scrollerElement)
  const scroller = chain.length > 0 ? chain[0] : null
  const rootReading = doc.documentElement ? captureNode(win, doc.documentElement) : null
  const scrollerMaxScrollTop = scroller ? Math.max(0, scroller.scrollH - scroller.clientH) : null
  const gridElement = doc.querySelector(SCHEDULE_GRID_SELECTOR)
  const currentWeekElement = doc.querySelector(CURRENT_WEEK_SELECTOR)
  const swipeStateElement = doc.querySelector(SCHEDULE_STAGE_SELECTOR)

  const snapshot: ScrollDiagnosticsSnapshot = {
    capturedAt: new Date().toISOString(),
    href: win.location?.href ?? '',
    env: {
      userAgent: win.navigator?.userAgent ?? '',
      innerW: win.innerWidth,
      innerH: win.innerHeight,
      dpr: win.devicePixelRatio,
      visualScale: win.visualViewport ? win.visualViewport.scale : null,
    },
    caps: {
      dvh: readCapability(win, 'height', '100dvh'),
      svh: readCapability(win, 'height', '100svh'),
      oklch: readCapability(win, 'color', 'oklch(60% 0.2 250)'),
      layer: readCapability(win, '--diag-layer', '@layer'),
      rootHeightMatchesViewport: rootReading ? Math.abs(parseFloat(rootReading.height) - win.innerHeight) <= VIEWPORT_TOLERANCE_PX : false,
      rootHeight: rootReading ? rootReading.height : '',
    },
    scroller,
    scrollerMaxScrollTop,
    scrollTopNow: scrollerElement ? readNumber(scrollerElement.scrollTop) : null,
    chain,
    clippingAncestors: chain.filter(
      (node, index) => index > 0 && node.clipsContent && node.clientH + 1 < (scroller ? scroller.scrollH : 0)
    ),
    pageScroller: findPageScroller(win, doc),
    grid: {
      found: Boolean(gridElement),
      clientH: gridElement ? readNumber(gridElement.clientHeight) : 0,
      scrollH: gridElement ? readNumber(gridElement.scrollHeight) : 0,
      zoom: readCustomProperty(win, gridElement, '--schedule-zoom'),
      currentWeek: currentWeekElement?.getAttribute?.('data-current-week') ?? null,
      swipeState: swipeStateElement?.getAttribute?.('data-week-swipe-state') ?? null,
    },
    gesture: observed?.gesture ?? {
      touchStart: 0,
      touchMove: 0,
      touchEnd: 0,
      pointerDown: 0,
      pointerMove: 0,
      scroll: 0,
      maxTouches: 0,
      maxPointerIds: 0,
      maxDragDy: 0,
    },
    gestureScroll: observed?.gestureScroll ?? { scrollTopBefore: null, scrollTopAfter: null },
    diagnosis: [],
  }

  snapshot.diagnosis = verdictHints(snapshot)
  return snapshot
}

/** 手势记录器的读数。 */
export type GestureRecorderReading = GestureCounters & GestureScrollReading

/** 手势记录器。 */
export type GestureRecorder = {
  start(): void
  stop(): void
  reset(): void
  reading(): GestureRecorderReading
}

function readTouchCount(event: Event): number {
  const touches = (event as Event & { touches?: ArrayLike<unknown> }).touches
  return touches ? touches.length : 0
}

/** 第一个触点的 `clientY`（没有触点时为 null）。 */
function readTouchY(event: Event): number | null {
  const touches = (event as Event & { touches?: ArrayLike<{ clientY?: unknown }> }).touches
  const first = touches && touches.length > 0 ? touches[0] : null
  const y = first?.clientY
  return typeof y === 'number' ? y : null
}

/** 指针事件的 `clientY`。 */
function readPointerY(event: Event): number | null {
  const y = (event as Event & { clientY?: unknown }).clientY
  return typeof y === 'number' ? y : null
}

function readPointerId(event: Event): number | null {
  const pointerId = (event as Event & { pointerId?: unknown }).pointerId
  return typeof pointerId === 'number' ? pointerId : null
}

/**
 * 记录拖动期间的事件计数与 `scrollTop` 变化。
 * 监听一律 `{ passive: true }`（不改被诊断行为），只统计不拦截。
 */
export function createGestureRecorder(win: GestureWindow, getScroller: () => DiagnosticElement | null): GestureRecorder {
  const counters: GestureCounters = {
    touchStart: 0,
    touchMove: 0,
    touchEnd: 0,
    pointerDown: 0,
    pointerMove: 0,
    scroll: 0,
    maxTouches: 0,
    maxPointerIds: 0,
    maxDragDy: 0,
  }
  let scrollTopBefore: number | null = null
  let scrollTopAfter: number | null = null
  let originY: number | null = null
  /** 记录本次手势相对起点的竖直位移峰值（先落下的那个点当起点）。 */
  const noteDrag = (y: number | null) => {
    if (y === null) return
    if (originY === null) originY = y
    counters.maxDragDy = Math.max(counters.maxDragDy, Math.abs(y - originY))
  }
  const activePointers = new Set<number>()
  let attached = false

  const handleTouchStart = (event: Event) => {
    counters.touchStart += 1
    counters.maxTouches = Math.max(counters.maxTouches, readTouchCount(event))
    noteDrag(readTouchY(event))
    if (scrollTopBefore === null) scrollTopBefore = getScroller()?.scrollTop ?? null
  }
  const handleTouchMove = (event: Event) => {
    counters.touchMove += 1
    counters.maxTouches = Math.max(counters.maxTouches, readTouchCount(event))
    noteDrag(readTouchY(event))
  }
  const handleTouchEnd = (event: Event) => {
    counters.touchEnd += 1
    // 手指数归零 = 本次手势结束：起点必须复位，否则下一次手势的位移会与上一次累加
    // （真机实测踩过：连续两次拖动会被算成 304px，把正常滚动误判成「跟不动手指」）。
    if (readTouchCount(event) === 0) {
      scrollTopAfter = getScroller()?.scrollTop ?? null
      originY = null
    }
  }
  const handlePointerDown = (event: Event) => {
    counters.pointerDown += 1
    const pointerId = readPointerId(event)
    if (pointerId !== null) activePointers.add(pointerId)
    counters.maxPointerIds = Math.max(counters.maxPointerIds, activePointers.size)
    if (scrollTopBefore === null) scrollTopBefore = getScroller()?.scrollTop ?? null
    noteDrag(readPointerY(event))
  }
  const handlePointerMove = (event: Event) => {
    counters.pointerMove += 1
    noteDrag(readPointerY(event))
    counters.maxPointerIds = Math.max(counters.maxPointerIds, activePointers.size)
  }
  const handlePointerEnd = (event: Event) => {
    const pointerId = readPointerId(event)
    if (pointerId !== null) activePointers.delete(pointerId)
    if (activePointers.size === 0) {
      scrollTopAfter = getScroller()?.scrollTop ?? null
      originY = null
    }
  }
  const handleScroll = () => {
    counters.scroll += 1
    const scroller = getScroller()
    if (scroller) scrollTopAfter = scroller.scrollTop ?? null
  }

  const listenerOptions: AddEventListenerOptions = { passive: true }

  return {
    start() {
      if (attached) return
      attached = true
      win.addEventListener('touchstart', handleTouchStart, listenerOptions)
      win.addEventListener('touchmove', handleTouchMove, listenerOptions)
      win.addEventListener('touchend', handleTouchEnd, listenerOptions)
      win.addEventListener('pointerdown', handlePointerDown, listenerOptions)
      win.addEventListener('pointermove', handlePointerMove, listenerOptions)
      win.addEventListener('pointerup', handlePointerEnd, listenerOptions)
      win.addEventListener('pointercancel', handlePointerEnd, listenerOptions)
      win.addEventListener('scroll', handleScroll, { passive: true, capture: true })
    },
    stop() {
      if (!attached) return
      attached = false
      win.removeEventListener('touchstart', handleTouchStart, listenerOptions)
      win.removeEventListener('touchmove', handleTouchMove, listenerOptions)
      win.removeEventListener('touchend', handleTouchEnd, listenerOptions)
      win.removeEventListener('pointerdown', handlePointerDown, listenerOptions)
      win.removeEventListener('pointermove', handlePointerMove, listenerOptions)
      win.removeEventListener('pointerup', handlePointerEnd, listenerOptions)
      win.removeEventListener('pointercancel', handlePointerEnd, listenerOptions)
      win.removeEventListener('scroll', handleScroll, { passive: true, capture: true })
    },
    reset() {
      counters.touchStart = 0
      counters.touchMove = 0
      counters.touchEnd = 0
      counters.pointerDown = 0
      counters.pointerMove = 0
      counters.scroll = 0
      counters.maxTouches = 0
      counters.maxPointerIds = 0
      counters.maxDragDy = 0
      originY = null
      scrollTopBefore = getScroller()?.scrollTop ?? null
      scrollTopAfter = null
      activePointers.clear()
    },
    reading() {
      return {
        ...counters,
        scrollTopBefore,
        scrollTopAfter,
      }
    },
  }
}
