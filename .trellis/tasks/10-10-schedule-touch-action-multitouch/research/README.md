# 复现与取证（多触点纵向拖动被拒绝）

## 现象一句话

`[data-schedule-scroll]`（`touch-action: pan-x pan-y`）**一旦本次触摸出现第二个触点，引擎就整体拒绝纵向滚动**，
且抬起第二指、只剩一根手指继续拖也不恢复。单指手势不受影响。

## 环境

- 真机引擎：Android 模拟器 `API 37.1`（System WebView **149.0.7827.5**），屏幕 `1080×1920@420` → CSS 视口 412×731、`dpr 2.625`。
- 对照组：`API 32`（System WebView **120.0.6099.193**）同样可跑（注：该引擎另有网格高度缺陷，见上游任务）。
- 应用：ClassTrack Capacitor 壳 APK，课表页已灌入测试种子数据（周次 3，含 13 行网格）。
- 所有手势通过 WebView 的 CDP `Input.dispatchTouchEvent` 帧脚本注入（跑脚本的临时目录不入库）。

## 手势矩阵结果（本任务 `research/evidence/after-grid-fix-chrome149/`）

网格高度修复（上游任务的 `min-h-full`）落地后重测，行为与基线逐项一致 ⇒ 二者互不影响：

| 文件 | 手势 | 结果 |
| --- | --- | --- |
| `m2-two-finger-parallel.json` | 双指平行竖直 | `scrollTop 0 → 0`（`maxTop 279`）✗ |
| `m3-staggered.json` | 中途落下第二指 | `scrollTop 0 → 0` ✗ |
| `m4-graze.json` | 擦碰第二点后抬起继续拖 | `scrollTop 0 → 0` ✗ |

同一批次里作为基线的对照项（说明不是「整体滚不动」，只是多触点被拒）：
`m1` 单指竖直 `0 → 278.86` ✓、`m5` 双指张开 `--schedule-zoom 1 → 2` ✓、`m6` 缩放后单指 `0 → 278.86` ✓、
`m7` 左边缘横滑切周 `data-current-week 3 → 2` ✓（上游任务同目录）。

## 同页替换 `touch-action` 的对照（`research/evidence/`）

运行期把 `[data-schedule-scroll]` 的 `touch-action` 逐个换成候选值再重放同一段手势（`t*.json`）：

| 取值 | 双指平行竖直 | 中途落第二指 | 单指 |
| --- | --- | --- | --- |
| `pan-x pan-y`（现状） | `0 → 0` ✗ | `0 → 0` ✗ | ✓ |
| `manipulation` | `0 → 278.86` ✓ | `0 → 10.29` | ✓（复原后 ✓） |
| `auto` | `0 → 278.86` ✓ | — | ✓ |

- 更早的对照实验（同一台模拟器）：注入**不属于 React 树、无任何应用 JS** 的普通 `div`，
  `auto` 双指竖直 `top 186` ✓ / `pan-x pan-y` 双指竖直 `top 0` ✗，两者单指都能滚
  ⇒ 拒绝来自 `touch-action` 取值本身，**不是应用 JS 拦截**（`useScheduleZoom` 的 `preventDefault()` 因 passive 监听不生效）。
- 因此本任务的候选改法优先选 `manipulation`（= `auto` 去掉双击缩放），但必须按 PRD R3 先实测
  「引擎自带 pinch-zoom 是否与应用内缩放叠加」。

## 待补

- 用户在设备上的读数（`gesture.maxTouches` 峰值）：判定本缺陷是否真的发生在他手上（PRD R1 / AC-2）。
- `manipulation` 下的双指缩放冲突读数（PRD R3 / AC-5）。
