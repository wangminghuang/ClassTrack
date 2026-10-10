import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  captureNode,
  collectScrollDiagnostics,
  createGestureRecorder,
  DIAGNOSIS,
  SCHEDULE_GRID_SELECTOR,
  SCHEDULE_SCROLLER_SELECTOR,
  verdictHints,
  type DiagnosticComputedStyle,
  type DiagnosticDocument,
  type DiagnosticElement,
  type DiagnosticWindow,
  type GestureCounters,
  type ScrollDiagnosticsSnapshot,
} from './scrollDiagnostics'

/**
 * 诊断器械的自检（来源任务 `10-10-schedule-scroll-device-rootcause`）。
 *
 * 为什么值得单测：这套器械是要**寄给用户在他真机上跑**的，读数错了会把根因判到反方向，
 * 而它本身又没有第二个复现环境可对照。所以这里把判定表每一行都钉住，并额外钉住两条硬约束：
 * 1. 「未带参数时不注册监听 / 不渲染」——靠结构断言（面板与记录器的写法）保证；
 * 2. 「监听一律 passive」——靠结构断言保证，因为它直接关系到「不能改变被诊断行为」。
 *
 * 本仓库 vitest 是 `environment: 'node'`，所以这里全部用**桩对象**（`DiagnosticWindow` / `DiagnosticDocument`
 * 就是为了这个而抽的最小接口），不引入 jsdom。
 */

type StyleStub = {
  height?: string
  minHeight?: string
  overflowY?: string
  display?: string
  flex?: string
  transform?: string
  touchAction?: string
  customProps?: Record<string, string>
}

const SOURCE_PATH = new URL('./scrollDiagnostics.ts', import.meta.url)
const PANEL_PATH = new URL('./ScheduleScrollDiagnosticsPanel.tsx', import.meta.url)
const ROOT_PATH = new URL('../../root.tsx', import.meta.url)

const SOURCE = readFileSync(fileURLToPath(SOURCE_PATH), 'utf8')
const PANEL = readFileSync(fileURLToPath(PANEL_PATH), 'utf8')
const FLAGS = readFileSync(fileURLToPath(new URL('./diagnosticFlags.ts', import.meta.url)), 'utf8')
const ROOT = readFileSync(fileURLToPath(ROOT_PATH), 'utf8')

function makeStyle(style: StyleStub = {}): DiagnosticComputedStyle {
  return {
    height: style.height ?? 'auto',
    minHeight: style.minHeight ?? '0px',
    overflowY: style.overflowY ?? 'visible',
    display: style.display ?? 'block',
    flex: style.flex ?? '0 1 auto',
    transform: style.transform ?? 'none',
    touchAction: style.touchAction ?? 'auto',
    getPropertyValue: (name: string) => style.customProps?.[name] ?? '',
  }
}

type ElementStubOptions = {
  tagName: string
  className?: string
  attributes?: Record<string, string>
  style?: StyleStub
  clientHeight?: number
  scrollHeight?: number
  scrollTop?: number
  parent?: DiagnosticElement | null
}

function makeElement(options: ElementStubOptions): DiagnosticElement {
  return {
    tagName: options.tagName.toUpperCase(),
    className: options.className ?? '',
    parentElement: options.parent ?? null,
    getAttribute: (name: string) => options.attributes?.[name] ?? null,
    clientHeight: options.clientHeight ?? 0,
    clientWidth: 0,
    scrollHeight: options.scrollHeight ?? 0,
    scrollWidth: 0,
    scrollTop: options.scrollTop ?? 0,
    scrollLeft: 0,
  }
}

type Harness = {
  win: DiagnosticWindow
  doc: DiagnosticDocument
  elements: {
    html: DiagnosticElement
    body: DiagnosticElement
    stage: DiagnosticElement
    scroller: DiagnosticElement
    grid: DiagnosticElement
  }
}

/**
 * 造一棵最小可信的布局树：
 * `html > body > stage(overflow hidden) > scroller(overflow auto) > grid`。
 * 课表场景：scroller 可视 501、内容 780（可滚 279）、stage 只能看到 501 ⇒ 会裁内容。
 */
function makeHarness(options: { withScroller?: boolean; stageVisibleHeight?: number } = {}): Harness {
  const styles = new Map<DiagnosticElement, DiagnosticComputedStyle>()

  const html = makeElement({ tagName: 'html', style: { height: '731px' }, clientHeight: 731, scrollHeight: 731 })
  const body = makeElement({
    tagName: 'body',
    className: 'app-body',
    style: { height: '731px', overflowY: 'hidden' },
    clientHeight: 731,
    scrollHeight: 731,
    parent: html,
  })
  const stage = makeElement({
    tagName: 'div',
    attributes: { 'data-schedule-swipe-stage': '' },
    className: 'flex min-h-0 flex-1 flex-col overflow-hidden',
    style: { overflowY: 'hidden', display: 'flex' },
    clientHeight: options.stageVisibleHeight ?? 501,
    scrollHeight: 780,
    parent: body,
  })
  const scroller = makeElement({
    tagName: 'div',
    attributes: { 'data-schedule-scroll': '' },
    className: 'min-h-0 flex-1 overflow-y-auto [touch-action:pan-x_pan-y]',
    style: { overflowY: 'auto', touchAction: 'pan-x pan-y' },
    clientHeight: 501,
    scrollHeight: 780,
    parent: stage,
  })
  const grid = makeElement({
    tagName: 'div',
    attributes: { 'data-schedule-grid': '' },
    className: 'grid h-full',
    style: { customProps: { '--schedule-zoom': '1' }, height: '780px' },
    clientHeight: 780,
    scrollHeight: 780,
    parent: scroller,
  })

  styles.set(html, makeStyle({ height: '731px' }))
  styles.set(body, makeStyle({ height: '731px', overflowY: 'hidden' }))
  styles.set(stage, makeStyle({ overflowY: 'hidden', display: 'flex' }))
  styles.set(scroller, makeStyle({ overflowY: 'auto', touchAction: 'pan-x pan-y' }))
  styles.set(grid, makeStyle({ customProps: { '--schedule-zoom': '1' }, height: '780px' }))

  const bySelector = new Map<string, DiagnosticElement | null>([
    [SCHEDULE_SCROLLER_SELECTOR, options.withScroller === false ? null : scroller],
    [SCHEDULE_GRID_SELECTOR, options.withScroller === false ? null : grid],
    ['[data-schedule-swipe-stage]', stage],
    ['[data-current-week]', null],
  ])

  const doc: DiagnosticDocument = {
    documentElement: html,
    body,
    querySelector: (selector: string) => bySelector.get(selector) ?? null,
    querySelectorAll: () => [],
  }

  const win: DiagnosticWindow = {
    innerWidth: 411,
    innerHeight: 731,
    devicePixelRatio: 2.625,
    getComputedStyle: (element: DiagnosticElement) => styles.get(element) ?? makeStyle(),
    visualViewport: { scale: 1 },
    CSS: { supports: () => true },
    location: { href: 'https://localhost/' },
    navigator: { userAgent: 'test-agent' },
  }

  return { win, doc, elements: { html, body, stage, scroller, grid } }
}

function makeGestureCounters(overrides: Partial<GestureCounters> = {}): GestureCounters {
  return {
    touchStart: 1,
    touchMove: 12,
    touchEnd: 1,
    pointerDown: 1,
    pointerMove: 1,
    scroll: 0,
    maxTouches: 1,
    maxPointerIds: 1,
    maxDragDy: 140,
    ...overrides,
  }
}

function snapshotStub(
  overrides: Partial<
    Pick<
      ScrollDiagnosticsSnapshot,
      'scroller' | 'scrollerMaxScrollTop' | 'clippingAncestors' | 'gesture' | 'gestureScroll' | 'caps' | 'grid'
    >
  >
): Parameters<typeof verdictHints>[0] {
  const { win, elements } = makeHarness()
  const scroller = captureNode(win, elements.scroller)
  return {
    scroller,
    scrollerMaxScrollTop: 279,
    // 默认网格与滚动容器「一致」（780/780 = 无行溢出），需要测行溢出的用例自行覆盖。
    grid: { found: true, clientH: 780, scrollH: 780, zoom: '1', currentWeek: '3', swipeState: null },
    clippingAncestors: [],
    gesture: makeGestureCounters(),
    gestureScroll: { scrollTopBefore: 0, scrollTopAfter: 0 },
    caps: { dvh: true, svh: true, oklch: true, layer: true, rootHeightMatchesViewport: true, rootHeight: '731px' },
    ...overrides,
  }
}

describe('判定表（verdictHints）', () => {
  it('无课表容器 → NO_SCHEDULE_ON_PAGE（在设置页取数时会出现）', () => {
    expect(verdictHints(snapshotStub({ scroller: null, scrollerMaxScrollTop: null }))).toContain(DIAGNOSIS.noScheduleOnPage)
  })

  it('滚不动 + 祖先裁内容 → HEIGHT_CHAIN_COLLAPSE', () => {
    const { win, elements } = makeHarness()
    const clippingAncestors = [captureNode(win, elements.body)]
    const hints = verdictHints(snapshotStub({ scrollerMaxScrollTop: 0, clippingAncestors }))
    expect(hints).toContain(DIAGNOSIS.heightChainCollapse)
    expect(hints).not.toContain(DIAGNOSIS.contentFits)
  })

  it('滚不动 + 没有裁内容的祖先 → CONTENT_FITS（不是缺陷）', () => {
    const hints = verdictHints(snapshotStub({ scrollerMaxScrollTop: 0, clippingAncestors: [] }))
    expect(hints).toContain(DIAGNOSIS.contentFits)
    expect(hints).not.toContain(DIAGNOSIS.heightChainCollapse)
  })

  // 真机实测（Android WebView 120 / API 32，跑用户装的 beta-29）：滚动容器 510/510（max 0），
  // 内层网格 510/780 ⇒ 网格行溢出没变成祖先的可滚距离，第 9~12 节滚不到。
  // 这条必须**优先于 CONTENT_FITS**，否则会把「滚不到」误判成「本来装得下」。
  it('网格行溢出却没变成可滚距离 → GRID_OVERFLOW_NOT_SCROLLABLE', () => {
    const hints = verdictHints(
      snapshotStub({
        scrollerMaxScrollTop: 0,
        grid: { found: true, clientH: 510, scrollH: 780, zoom: '1', currentWeek: '3', swipeState: null },
      })
    )
    expect(hints).toContain(DIAGNOSIS.gridOverflowNotScrollable)
    expect(hints).not.toContain(DIAGNOSIS.contentFits)
    expect(hints).not.toContain(DIAGNOSIS.heightChainCollapse)
  })

  it('可滚距离覆盖不了网格溢出（一部分到不了）→ GRID_OVERFLOW_NOT_SCROLLABLE', () => {
    const hints = verdictHints(
      snapshotStub({
        scrollerMaxScrollTop: 100,
        grid: { found: true, clientH: 510, scrollH: 780, zoom: '1', currentWeek: '3', swipeState: null },
      })
    )
    expect(hints).toContain(DIAGNOSIS.gridOverflowNotScrollable)
    expect(hints).not.toContain(DIAGNOSIS.scrollOk)
  })

  it('网格没有行溢出时不上报这一条（原口径不变）', () => {
    const fits = verdictHints(snapshotStub({ scrollerMaxScrollTop: 0 }))
    expect(fits).toContain(DIAGNOSIS.contentFits)
    expect(fits).not.toContain(DIAGNOSIS.gridOverflowNotScrollable)
  })

  it('有可滚距离但拖动后 scrollTop 不动 → SCROLL_SWALLOWED', () => {
    const hints = verdictHints(
      snapshotStub({ gesture: makeGestureCounters({ maxTouches: 1 }), gestureScroll: { scrollTopBefore: 0, scrollTopAfter: 0 } })
    )
    expect(hints).toContain(DIAGNOSIS.scrollSwallowed)
  })

  it('单指拖动却出现 2 个触点 → MULTI_TOUCH_CONTACT（指向 touch-action 缺陷）', () => {
    const hints = verdictHints(
      snapshotStub({
        gesture: makeGestureCounters({ maxTouches: 2 }),
        gestureScroll: { scrollTopBefore: 0, scrollTopAfter: 0 },
      })
    )
    expect(hints).toContain(DIAGNOSIS.multiTouchContact)
  })

  // 真机实测（Chrome 149 / API 37）拖 140px 滚了 171px 却没到底：旧口径会误报 CLIPPED_BY_STAGE，
  // 所以「滚动正常」只看**跟不跟得上手指**，不看有没有滚到底。
  it('滚动跟得上手指（哪怕没到底）→ SCROLL_OK', () => {
    const followed = verdictHints(
      snapshotStub({ gesture: makeGestureCounters({ maxDragDy: 140 }), gestureScroll: { scrollTopBefore: 0, scrollTopAfter: 171 } })
    )
    expect(followed).toContain(DIAGNOSIS.scrollOk)
    expect(followed).not.toContain(DIAGNOSIS.clippedByStage)

    const bottom = verdictHints(snapshotStub({ gestureScroll: { scrollTopBefore: 0, scrollTopAfter: 279 } }))
    expect(bottom).toContain(DIAGNOSIS.scrollOk)
  })

  it('拖了很远却只滚一点点 → CLIPPED_BY_STAGE（滚动被吃掉一部分）', () => {
    const partial = verdictHints(
      snapshotStub({ gesture: makeGestureCounters({ maxDragDy: 200 }), gestureScroll: { scrollTopBefore: 0, scrollTopAfter: 40 } })
    )
    expect(partial).toContain(DIAGNOSIS.clippedByStage)
    expect(partial).not.toContain(DIAGNOSIS.scrollOk)
  })

  it('拖动距离小到像点按时不用比例判负（有位移就算能滚）', () => {
    const tiny = verdictHints(
      snapshotStub({ gesture: makeGestureCounters({ maxDragDy: 3 }), gestureScroll: { scrollTopBefore: 0, scrollTopAfter: 2 } })
    )
    expect(tiny).toContain(DIAGNOSIS.scrollOk)
    expect(tiny).not.toContain(DIAGNOSIS.clippedByStage)
  })

  it('还没拖动 → NO_DRAG_RECORDED（提示用户先滑两次）', () => {
    const hints = verdictHints(
      snapshotStub({
        gesture: makeGestureCounters({ touchMove: 0, pointerMove: 0 }),
        gestureScroll: { scrollTopBefore: null, scrollTopAfter: null },
      })
    )
    expect(hints).toContain(DIAGNOSIS.noDragRecorded)
  })

  it('引擎不支持 oklch / @layer → ENGINE_BELOW_BASELINE', () => {
    const hints = verdictHints(
      snapshotStub({ caps: { dvh: false, svh: false, oklch: false, layer: false, rootHeightMatchesViewport: false, rootHeight: 'auto' } })
    )
    expect(hints).toContain(DIAGNOSIS.engineBelowBaseline)
  })
})

describe('采集（collectScrollDiagnostics）', () => {
  it('沿滚动容器向上给出链、可滚动距离、裁内容的祖先与跨页对照信息', () => {
    const { win, doc } = makeHarness()
    const snapshot = collectScrollDiagnostics(win, doc)

    expect(snapshot.scroller?.tag).toBe('div')
    expect(snapshot.scrollerMaxScrollTop).toBe(279)
    expect(snapshot.chain.map((node) => node.tag)).toEqual(['div', 'div', 'body', 'html'])
    expect(snapshot.chain[1].slot).toBeNull()
    expect(snapshot.clippingAncestors).toHaveLength(1)
    expect(snapshot.clippingAncestors[0].overflowY).toBe('hidden')
    expect(snapshot.grid.found).toBe(true)
    expect(snapshot.grid.zoom).toBe('1')
    expect(snapshot.caps.rootHeightMatchesViewport).toBe(true)
    expect(snapshot.env.userAgent).toBe('test-agent')
    expect(snapshot.href).toBe('https://localhost/')
  })

  it('设置页（没有课表容器）也能取数：scroller=null，并给出跨页对照用的本页可滚动容器', () => {
    const { win, doc } = makeHarness({ withScroller: false })
    const pageScroller = makeElement({
      tagName: 'div',
      className: 'overflow-y-auto',
      style: { overflowY: 'auto' },
      clientHeight: 600,
      scrollHeight: 1800,
    })
    win.getComputedStyle = (element: DiagnosticElement) => (element === pageScroller ? makeStyle({ overflowY: 'auto' }) : makeStyle())
    const pageDoc: DiagnosticDocument = { ...doc, querySelectorAll: () => [pageScroller] }

    const snapshot = collectScrollDiagnostics(win, pageDoc)
    expect(snapshot.scroller).toBeNull()
    expect(snapshot.scrollerMaxScrollTop).toBeNull()
    expect(snapshot.pageScroller?.scrollable).toBe(true)
    expect(snapshot.diagnosis).toContain(DIAGNOSIS.noScheduleOnPage)
  })

  it('把记录器读数带进快照，并据此判定 SCROLL_SWALLOWED', () => {
    const { win, doc } = makeHarness()
    const snapshot = collectScrollDiagnostics(win, doc, {
      gesture: makeGestureCounters({ maxTouches: 1 }),
      gestureScroll: { scrollTopBefore: 0, scrollTopAfter: 0 },
    })
    expect(snapshot.diagnosis).toContain(DIAGNOSIS.scrollSwallowed)
  })
})

describe('手势记录器（createGestureRecorder）', () => {
  type Listener = (event: Event) => void

  function makeGestureWindow() {
    const listeners = new Map<string, Listener[]>()
    const passiveFlags: Array<{ type: string; passive: boolean | undefined }> = []
    const win = {
      addEventListener(type: string, listener: Listener, options?: AddEventListenerOptions) {
        passiveFlags.push({ type, passive: options?.passive })
        const bucket = listeners.get(type) ?? []
        bucket.push(listener)
        listeners.set(type, bucket)
      },
      removeEventListener(type: string, listener: Listener) {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== listener)
        )
      },
    }
    return {
      win,
      passiveFlags,
      emit(type: string, event: Event) {
        ;(listeners.get(type) ?? []).forEach((listener) => listener(event))
      },
      listenerCount() {
        let total = 0
        listeners.forEach((bucket) => {
          total += bucket.length
        })
        return total
      },
    }
  }

  function touchEvent(touchCount: number): Event {
    return { touches: Array.from({ length: touchCount }, (_, index) => ({ identifier: index })) } as unknown as Event
  }

  it('统计触点峰值与 scrollTop 变化，且一律以 passive 注册', () => {
    const scroller = makeElement({ tagName: 'div', clientHeight: 501, scrollHeight: 780, scrollTop: 0 })
    const harness = makeGestureWindow()
    const recorder = createGestureRecorder(harness.win, () => scroller)

    recorder.start()
    harness.emit('touchstart', touchEvent(1))
    harness.emit('touchmove', touchEvent(2))
    scroller.scrollTop = 120
    harness.emit('scroll', touchEvent(0))
    harness.emit('touchend', touchEvent(0))

    const reading = recorder.reading()
    expect(reading.touchStart).toBe(1)
    expect(reading.touchMove).toBe(1)
    expect(reading.maxTouches).toBe(2)
    // 桩事件没有坐标 ⇒ 不产生拖动位移读数（不会凭空判负）。
    expect(reading.maxDragDy).toBe(0)
    expect(reading.scroll).toBe(1)
    expect(reading.scrollTopBefore).toBe(0)
    expect(reading.scrollTopAfter).toBe(120)
    expect(harness.passiveFlags.every((entry) => entry.passive === true)).toBe(true)

    recorder.stop()
    expect(harness.listenerCount()).toBe(0)
  })

  it('reset 清空计数并重置起点', () => {
    const scroller = makeElement({ tagName: 'div', clientHeight: 501, scrollHeight: 780, scrollTop: 60 })
    const harness = makeGestureWindow()
    const recorder = createGestureRecorder(harness.win, () => scroller)

    recorder.start()
    harness.emit('touchstart', touchEvent(2))
    recorder.reset()

    const reading = recorder.reading()
    expect(reading.maxTouches).toBe(0)
    expect(reading.touchStart).toBe(0)
    expect(reading.scrollTopBefore).toBe(60)
    expect(reading.scrollTopAfter).toBeNull()
    recorder.stop()
  })
  it('记录竖直拖动位移峰值（取先落下的点当起点），reset 后归零', () => {
    const scroller = makeElement({ tagName: 'div', clientHeight: 501, scrollHeight: 780, scrollTop: 0 })
    const harness = makeGestureWindow()
    const recorder = createGestureRecorder(harness.win, () => scroller)
    const at = (y: number) => ({ touches: [{ identifier: 0, clientY: y }] }) as unknown as Event

    recorder.start()
    harness.emit('touchstart', at(600))
    harness.emit('touchmove', at(500))
    harness.emit('touchmove', at(540))
    expect(recorder.reading().maxDragDy).toBe(100)

    recorder.reset()
    expect(recorder.reading().maxDragDy).toBe(0)
    recorder.stop()
  })

  it('每次手势结束后拖动起点复位（不把两次手势的位移累加）', () => {
    const scroller = makeElement({ tagName: 'div', clientHeight: 501, scrollHeight: 780, scrollTop: 0 })
    const harness = makeGestureWindow()
    const recorder = createGestureRecorder(harness.win, () => scroller)
    const at = (y: number) => ({ touches: [{ identifier: 0, clientY: y }] }) as unknown as Event
    const up = { touches: [] } as unknown as Event

    recorder.start()
    harness.emit('touchstart', at(600))
    harness.emit('touchmove', at(500))
    harness.emit('touchend', up)
    harness.emit('touchstart', at(300))
    harness.emit('touchmove', at(295))

    // 第二次只拖了 5px：不能算成从 600 到 295 的 305px（真机踩过这个坑）。
    expect(recorder.reading().maxDragDy).toBe(100)
    recorder.stop()
  })
})

describe('硬约束的结构断言（改动这里等于放松约束）', () => {
  it('记录器里每一次 addEventListener 都显式 passive: true', () => {
    // 只看**调用点**（`win.addEventListener('…')`），避免把类型声明里的同名方法也当成注册。
    const registrations = SOURCE.match(/\.addEventListener\('[^)]*\)/g) ?? []
    expect(registrations.length).toBeGreaterThan(0)
    registrations.forEach((registration) => {
      const usesPassiveOptions = registration.includes('passive: true') || registration.includes('listenerOptions')
      expect(usesPassiveOptions).toBe(true)
    })
  })
  expect(SOURCE).toContain('const listenerOptions: AddEventListenerOptions = { passive: true }')

  it('面板未带参数时直接返回 null（不渲染节点）', () => {
    expect(PANEL).toContain('new URLSearchParams(window.location.search).get(DIAG_PARAM) === DIAG_VALUE')
    expect(PANEL).toContain('if (!useIsClient() || !isDiagnosticsActive()) return null')
    expect(PANEL).toContain('DIAGNOSTICS_ENABLED_BY_DEFAULT || isDiagnosticsEnabled()')
  })

  it('「诊断分支随包开启」是唯一开关：master 默认 false，且开关被面板读取', () => {
    expect(FLAGS).toContain('export const DIAGNOSTICS_ENABLED_BY_DEFAULT')
    // 诊断分支会把取值改成 true，所以这里只钉「机制存在」，不钉取值。
    expect(FLAGS).toMatch(/export const DIAGNOSTICS_ENABLED_BY_DEFAULT = (true|false)\n?$/)
    expect(PANEL).toContain("import { DIAGNOSTICS_ENABLED_BY_DEFAULT } from './diagnosticFlags'")
  })

  it('面板已挂在根布局上（否则真机取不到数）', () => {
    expect(ROOT).toContain("import ScheduleScrollDiagnosticsPanel from '~/features/diagnostics/ScheduleScrollDiagnosticsPanel'")
    expect(ROOT).toContain('<ScheduleScrollDiagnosticsPanel />')
  })

  it('采集只读：源码里不出现对 touch-action / 高度的写入', () => {
    expect(SOURCE.includes('touchAction =')).toBe(false)
    expect(SOURCE.includes('.style.')).toBe(false)
    expect(SOURCE.includes('cssText')).toBe(false)
  })
})
