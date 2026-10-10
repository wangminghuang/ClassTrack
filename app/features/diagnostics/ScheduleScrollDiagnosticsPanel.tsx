import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import {
  collectScrollDiagnostics,
  createGestureRecorder,
  DIAG_PARAM,
  DIAG_VALUE,
  SCHEDULE_SCROLLER_SELECTOR,
  type DiagnosticDocument,
  type DiagnosticElement,
  type DiagnosticWindow,
  type ScrollDiagnosticsSnapshot,
} from './scrollDiagnostics'
import { DIAGNOSTICS_ENABLED_BY_DEFAULT } from './diagnosticFlags'

/**
 * 课表滚动诊断浮层（**诊断包专用**，来源任务 `10-10-schedule-scroll-device-rootcause`）。
 *
 * 为什么是浮层而不是页面：用户真机复现不到本机引擎上，需要在**他现场操作**时把读数取回来；
 * 浮层挂在任意路由上（`?diag=schedule-scroll`），既能在课表页取数、也能在设置页取同一份读数做跨页对照。
 *
 * 三条硬约束（见任务 `design.md` R3）：
 * 1. 未带参数时**不渲染任何节点、不注册任何监听**；
 * 2. 采集只读不写：不改 `touch-action`、不改高度，监听一律 passive；
 * 3. 浮层自身标 `data-diag-ignore`，避免它的输入框被当成「本页可滚动容器」污染对照读数。
 */

/** 是否处于诊断模式（只在浏览器端判定，避免 SSR 与首屏水合不一致）。 */
function isDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get(DIAG_PARAM) === DIAG_VALUE
}

/** 只在浏览器端渲染（`getServerSnapshot` 恒为 false），避免 SSR 与首屏水合不一致。 */
const subscribeToNothing = () => () => {}

function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  )
}

export default function ScheduleScrollDiagnosticsPanel() {
  if (!useIsClient() || !isDiagnosticsActive()) return null

  return <DiagnosticsPanelBody />
}

/**
 * 浮层是否启用：诊断分支上由编译期开关直接打开（用户改不了 URL），
 * master 上只有带 `?diag=schedule-scroll` 时才开，便于本地自查。
 */
function isDiagnosticsActive(): boolean {
  return DIAGNOSTICS_ENABLED_BY_DEFAULT || isDiagnosticsEnabled()
}

function DiagnosticsPanelBody() {
  const recorder = useMemo(
    () => createGestureRecorder(window, () => document.querySelector(SCHEDULE_SCROLLER_SELECTOR) as unknown as DiagnosticElement | null),
    []
  )
  const [reading, setReading] = useState(() => recorder.reading())
  const [snapshot, setSnapshot] = useState<ScrollDiagnosticsSnapshot | null>(null)
  const [status, setStatus] = useState('① 打开课表 ② 单指从下往上滑两次 ③ 点「冻结读数」，再截图或全选复制')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    recorder.start()
    const timer = window.setInterval(() => setReading(recorder.reading()), 500)
    return () => {
      window.clearInterval(timer)
      recorder.stop()
    }
  }, [recorder])

  const handleCapture = useCallback(() => {
    const current = recorder.reading()
    const { scrollTopBefore, scrollTopAfter, ...gesture } = current
    const next = collectScrollDiagnostics(window as unknown as DiagnosticWindow, document as unknown as DiagnosticDocument, {
      gesture,
      gestureScroll: { scrollTopBefore, scrollTopAfter },
    })
    setSnapshot(next)
    setStatus(next.diagnosis.length > 0 ? `判定线索：${next.diagnosis.join(' / ')}` : '已冻结读数（未命中判定表任何一行）')
  }, [recorder])

  const handleReset = useCallback(() => {
    recorder.reset()
    setSnapshot(null)
    setReading(recorder.reading())
    setStatus('已重新开始记录：请再滑两次后点「冻结读数」')
  }, [recorder])

  const handleCopy = useCallback(async () => {
    if (!snapshot) return
    const text = JSON.stringify(snapshot, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setStatus('已复制到剪贴板；若粘贴不到，请长按文本框 → 全选 → 复制')
    } catch {
      textareaRef.current?.focus()
      textareaRef.current?.select()
      setStatus('已在文本框内全选：长按 → 复制')
    }
  }, [snapshot])

  const snapshotText = snapshot ? JSON.stringify(snapshot, null, 2) : ''

  // 浮层只占底部 34vh：用户要在这块浮层**上方**的课表区域滑动，留出的滑动区必须够大
  // （58vh 时在 411×692 的设备上只剩 291px，真机 ADB 滑动会整段落进浮层里，白白查一轮）。
  return (
    <div
      data-diag-ignore="true"
      className="fixed inset-x-0 bottom-0 z-[2147483647] max-h-[34vh] overflow-y-auto border-t border-border bg-card p-3 text-xs text-card-foreground shadow-lg"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold">课表滚动诊断（诊断包专用）</span>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={handleCapture}>
          冻结读数
        </button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={handleReset}>
          重新开始记录
        </button>
        <button
          type="button"
          className="rounded border border-border px-2 py-1 disabled:opacity-50"
          onClick={handleCopy}
          disabled={!snapshot}
        >
          全选复制
        </button>
      </div>

      <p className="mb-1">{status}</p>

      <p className="mb-1 font-mono">
        实时计数 touch {reading.touchStart}/{reading.touchMove}/{reading.touchEnd} · pointer {reading.pointerDown}/{reading.pointerMove} ·
        scroll {reading.scroll} · 触点峰值 {reading.maxTouches} · 拖动 {Math.round(reading.maxDragDy)}px · scrollTop{' '}
        {reading.scrollTopBefore ?? '-'} → {reading.scrollTopAfter ?? '-'}
      </p>

      <textarea
        ref={textareaRef}
        readOnly
        value={snapshotText}
        placeholder="点「冻结读数」后这里出现可复制的 JSON"
        className="h-40 w-full resize-y rounded border border-border bg-background p-2 font-mono text-[11px] leading-tight"
      />
    </div>
  )
}
