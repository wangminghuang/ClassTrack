# 手机端课表边缘滑动切周的真机触摸验收（补 AC-18）

> 本任务**只做验收，不改功能代码**（除非验收暴露缺陷 —— 那时按 Phase 1 重新走规划，或按缺陷单独处理）。
> 前置任务：`../archive/2026-09/09-29-schedule-edge-swipe-week-switch/`（功能已实现、已提交，五项门禁全绿）。

## Goal

把前置任务里因**环境不可用**而无法执行的真机触摸验收补完，并把「真机行为才算数」的缺口关掉。
前置任务当时的环境阻塞（已实测，见其 `verification.md`）：

- `/dev/kvm` 不存在 → `emulator -accel-check` 报 KVM 不可用（x86_64 AVD 需要硬件加速）；
- `~/.android` 是**只读**挂载 → 无法清理陈旧的 `multiinstance.lock`，emulator 启动即
  `FATAL: A snapshot operation for 'Medium_Phone' is pending and timeout has expired. Exiting.`；
- `adb devices` 为空（无物理设备）；
- 每次 bash 调用是新的 net/pid 命名空间 → 模拟器 + adb + gradle 必须挤在同一次调用内完成。

**开工前先复核这四条**；只要还有一条成立，本任务就无法执行，直接回报环境不可用（不要造假证据）。

## 被验对象（实现要点，验收时用来定位）

| 文件 | 作用 |
|---|---|
| `app/features/schedule/weekSwipe.ts` | 纯函数核（阻尼曲线 / 方向 / 阈值 / 边界 / 滑出滑入方向），已在浏览器侧验证 |
| `app/features/schedule/hooks/useWeekSwipeGesture.ts` | 手势层：被动 `touchmove` 观测、位移写在滚容器自身、每帧互斥规则、三段切周动画 |
| `app/features/schedule/ScheduleTable.tsx` | `[data-schedule-swipe-stage]` 裁剪层 + `[data-schedule-scroll]` 接收位移 |
| `app/features/schedule/hooks/useScheduleZoom.ts` | `pointercancel` 不再参与双击判定 + `pointerup` 的按下点位移校验 |
| 开关 | 个人中心「课表显示」→「左右边缘滑动切换周」（`scheduleDisplayStore.edgeSwipeWeekSwitch`，默认开） |

测试挂钩：`data-week-swipe-state`（`idle`/`dragging`/`switching`，开关关闭时不存在）、`data-current-week`（顶栏）、
`data-schedule-swipe-stage`、`data-schedule-scroll`、`data-schedule-grid`。

## 范围

### 做（按 `classtrack-android-webview-verify` skill 执行）

用 AVD `Medium_Phone` + APK + WebView CDP 断言 DOM 数值 + `adb shell input swipe/tap` 真实系统触摸：

1. **F1（最高优先）**：2x 缩放下把课表横向滚到最右边缘，再用 CDP `Input.dispatchTouchEvent` 继续左拖，
   读 `[data-schedule-scroll]` 的 computed `transform`。**恒为 0 表示 F1 成立** → 停止验收、回报，
   与用户确认是否改走方案 B（`touch-action: pan-y` + 自实现横向滚动与惯性），**不得静默换实现**。
2. 1x：横滑拖动中 `transform` 非 `none`、`data-week-swipe-state === 'dragging'`；松手过阈值 → `data-current-week` ±1；
   不足阈值 → 回弹且周次不变。
3. 边界：第 1 周右滑有位移但 `data-current-week` 仍为 1；`maxWeek` 左滑同理。
4. 零回归：`adb shell input tap`（坐标 = CSS px × 2.625）点课程格 → 课程详情弹窗打开；
   纵向拖动 → 容器 `scrollTop` 变化且 `transform` 恒为 `none`。
5. 双击缩放仍生效（两次真实 `input tap`，间隔 < 300ms、位移 < 24px → 缩放档位切换）；
   **连续两次横滑 → 缩放档位不变**（`data-zoom-level`）。
6. 关闭开关后重复第 2 条 → 无位移、周次不变、`data-week-swipe-state` 不存在。
7. 复位：每个场景结束后 `inlineTransform === ''`、`computedTransform === 'none'`、`opacity === '1'`。
8. 顺带看一眼真机观感：`SWITCH_OUT_DURATION_MS = 110` / `SWITCH_IN_DURATION_MS = 170` / `SWITCH_TRAVEL_PX = 64`
   是否合适（不合格只调这三个常量，不动结构）。

### 不做

- 不改手势结构、不改 `touch-action`、不改滚动/缩放行为。
- 不重跑已由浏览器侧真实触摸覆盖的手势数学（那些已有证据）。

## 前置修复（2026-09-29 新增）

AC-4 里的「纵向滚动零回归」在真机上曾因**另一个原因**失败：`html/body` 的 `height: 100%` 兜底被构建器
（Tailwind v4 → lightningcss 把「被后一条覆盖的冗余声明」删掉）删掉，产物里只剩 `height: 100dvh`；
不支持 `dvh` 的 WebView（Chromium ≤ 107，Android 12 出厂 WebView 就在这条线以下）上 `html/body` 变成
`height: auto`，课表滚动容器 `scrollHeight == clientHeight` —— **课表完全无法上下滑动**（与手势层无关）。
该缺陷已由任务 `../09-29-fix-schedule-scroll-legacy-webview/` 修复（改为 `@supports (height: 100dvh)` 独立升级块）。

因此本任务执行时注意两点：

- 若被测设备的 WebView 是 Chromium ≤ 107，**先确认手上的 APK 含该修复**，否则 AC-4 会以「课表滑不动」失败，
  而那不是手势层的问题；
- AC-4 的纵向滚动一条可直接复用修复任务的器械
  `../09-29-fix-schedule-scroll-legacy-webview/research/cdp-dvh-equivalent.mjs`
  （把 `height:100dvh` 声明从 CSSOM 删掉即等价于旧引擎），或直接在该设备上量 `maxScrollTop`。

## 验收标准

- [ ] **AC-1** F1 在 Android WebView 上复核：边缘继续同向拖时阻尼位移出现（或如实回报 F1 成立并停止）
- [ ] **AC-2** 1x / 2x 的「先滚动、到边缘后阻尼」与切周在真机各至少一条证据
- [ ] **AC-3** 边界（第 1 周 / `maxWeek`）有阻尼但不切周
- [ ] **AC-4** 课程格点按、纵向滚动零回归
- [ ] **AC-5** 双击缩放生效 + 连续两次横滑不切换缩放档位
- [ ] **AC-6** 开关关闭后横滑无位移、不切周
- [ ] **AC-7** 证据（DOM 数值 + 截图，命名 `android-emulator-*.png` 与服务端证据分开）归档到本任务 `research/`
- [ ] **AC-8** 若发现缺陷：按 Phase 1 重新规划（写清行为缺口与落点），不要在验收任务里顺手改代码

## 复用材料

- 前置任务 `research/cdp-touch-swipe.mjs`（CDP 真实触摸脚本，`full`/`off`/`shot`/`drag1` 四模式）可直接复用；
  它对 **page** target 的 `webSocketDebuggerUrl` 工作，对 browser target 会报 `Runtime.evaluate wasn't found`。
- 前置任务 `research/baseline-before.md`（改动后的基线数字）与 `research/web-touch-scenarios.json`（浏览器侧对照）。
- 种子数据：`archive/2026-09/09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js`（`currentWeek = 3`、`maxWeek = 16`）。
