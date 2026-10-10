# 修复课表滚动容器 `touch-action: pan-x pan-y` 引起的多触点纵向拖动失效

## 来源

在任务 `10-10-schedule-scroll-device-rootcause`（课表滑不动根因）的取证过程中发现的**相邻独立缺陷**。
该任务的 R5 要求「`touch-action` 多触点缺陷必须明确处置（本任务一并修，或新建任务并留指针）」，此处即其落点。
本缺陷**不是**用户「单指也滑不动」的根因（单指在任何 `touch-action` 取值下都能滚），二者不可混为一谈。

## 现象

`app/features/schedule/ScheduleTable.tsx` 的滚动容器 `[data-schedule-scroll]` 带 `[touch-action:pan-x_pan-y]`。
真实 Android WebView（Chrome 149，1080×1920@420）实测：一旦本次触摸出现**第二个触点**，
引擎就整体拒绝纵向滚动，即使随后抬起第二指、只剩一根手指继续拖也不恢复。

| 手势 | `pan-x pan-y`（现状） | `manipulation` | `auto` |
| --- | --- | --- | --- |
| 单指竖直拖动 | 0 → **278.86** ✓ | ✓ | ✓ |
| 双指平行竖直 | 0 → **0** ✗ | 0 → **278.86** ✓ | 0 → 278.86 ✓ |
| 中途落下第二指 | 0 → **0** ✗ | 0 → 10.29（仅初始增量） | — |
| 擦碰第二点后抬起继续拖 | 0 → **0** ✗ | — | — |
| 双指张开（缩放） | `--schedule-zoom` 1 → **2** ✓ | ✓ | — |
| 缩放后单指竖直 | 0 → **278.86** ✓ | — | — |

- 对照实验（注入**不属于 React 树**、无任何应用 JS 的普通 `div`）：`auto` 双指竖直 `top 186` ✓；
  `pan-x pan-y` 双指竖直 `top 0` ✗；两者单指都能滚（182 / 192）
  ⇒ 拒绝来自 `touch-action` 取值本身，不是应用 JS 拦截
  （`useScheduleZoom` 的 `event.preventDefault()` 因 React 17+ 的 passive 监听实际不生效）。
- 现实触发场景：用户握持时拇指根部/另一只手指擦到屏幕，或习惯双指上滑 —— 都会让课表「突然又滑不动」，
  与用户报的「较稳定复现（非 100%）」在体感上同源，但本任务**不主张**它能解释用户的单指失效。

## Requirements

- **R1 先把口径说清**：确认本缺陷在用户设备上是否实际发生（诊断读数里 `gesture.maxTouches` 峰值 ≥ 2 即为证据）；
  若用户单指场景的峰值恒为 1，则本任务只作为防御性修复，不参与根因认定。
- **R2 不牺牲其它手势**：候选改法 `manipulation`（= `auto` 去掉双击缩放）必须逐项保住在用的手势：
  单指纵向滚动、左右横滑切周（`09-29-schedule-edge-swipe-device-verify` 的约定）、**应用自身的双指缩放**
  （`useScheduleZoom`）、缩放后的纵向滚动。
- **R3 双指缩放冲突必须实测**：`manipulation` 放开了引擎自带的 pinch-zoom，可能与应用内缩放叠加成「双重缩放」；
  必须在真机引擎上确认 Capacitor WebView 是否可缩放（若不可缩放则无冲突，需留读数）。
- **R4 零回归**：门禁全绿（`typecheck` / `lint` / `format:check` / `test` / `webview:check-css` / `test:webview-css` / `build`），
  且 Chrome 120 / 149 双引擎手势矩阵逐项与基线一致。
- **R5 仓库内不得出现环境凭据或本地绝对路径**（沿用 `env-setup.md` 口径）。

## Acceptance Criteria

- [ ] **AC-1** 缺陷的**真机**复现记录落在 `research/evidence/`（含 `pan-x pan-y` 与候选改法的同机对照）。
- [ ] **AC-2** 用户在设备上用诊断读数确认 `gesture.maxTouches` 峰值（判定本缺陷是否真的发生在他手上）。
- [ ] **AC-3** 改法落地后真机实测：带第二触点的纵向拖动 `scrollTop → maxScrollTop`（不再停在 0）。
- [ ] **AC-4** 手势回归逐项通过：单指纵向、左右横滑切周、应用内双指缩放、缩放后纵向滚动、边缘滑动开关开/关。
- [ ] **AC-5** 双指缩放的冲突结论有读数支撑（叠加与否），并在 spec 里写明 `touch-action` 取值约定。
- [ ] **AC-6** 门禁全绿；仓库无凭据/本地绝对路径。

## Notes

- 复现数据与命令见 `research/README.md`（本任务的 `research/evidence/` 已含原始读数）。
- 相关 spec：`.trellis/spec/frontend/mobile-schedule-layout.md`。
- 上游任务：`10-10-schedule-scroll-device-rootcause`（其 R5 指定本任务为落点）。
