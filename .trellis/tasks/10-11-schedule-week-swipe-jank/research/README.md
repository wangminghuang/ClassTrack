# 研究记录：松手切周卡顿（2026-10-11）

本目录记录 **10-11-schedule-week-swipe-jank** 的实验、读数与结论边界。所有读数来自本机
Chrome 155（headless，`--executable-path /usr/bin/google-chrome`）跑**生产构建** + CDP 真实触摸事件，
课程数据是归档的**合成夹具**（18 格，无任何真实用户数据）。

## 1. 被测对象与复现口径

| 项 | 值 |
| --- | --- |
| 应用资产 | `pnpm build` 产物，`python3 -m http.server` 托管 `build/client`（SPA，直接吃生产 CSS/JS） |
| 引擎 | HeadlessChrome 155，412×731 CSS px（另有 360×794 / 1440×900） |
| 种子 | 归档夹具 `09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js`，`currentWeek=3`、18 格 |
| 手势 | CDP `Input.dispatchTouchEvent`：`touchStart` → 12 步 `touchMove`（200px 位移）→ `touchEnd` |
| 采集 | `touchend` 打松手时刻；`requestAnimationFrame` 每帧计时；`PerformanceObserver(['longtask'])` 采长任务 |
| 判据 | 松手后 400ms 窗口内的最大帧间隔与长任务；同时断言「一次手势只切一周、结束态 `idle`、无残留 transform/opacity」 |

一键复跑：`PERF_ASSERT=1 bash research/run-browser-perf.sh 1 <out.json>`（第二个参数是 CPU 降速倍率）。

## 2. 实验清单

| # | 实验 | 观测 | 结论 | 数据 |
| --- | --- | --- | --- | --- |
| E1 | 基线（未改动，rate=1） | 6 次左右交替切周：长任务 672–824ms，松手后最大帧间隔 1083–1317ms；切周与结束态断言全部通过 | 卡顿确实发生在**松手后**，且不是「动画时长太长」而是主线程被占住 | `baseline-profile.json` |
| E2 | 同一轮的 CPU profile | 最重的两条栈都在 `ScheduleCourseCell` 的 `content.scrollHeight - content.clientHeight`，合计约 7161ms | 热点是课程格空间自适应的**同步布局读取**，不是 React 渲染或持久化 | `baseline-profile.json.cpuprofile` |
| E3 | 只把测量 effect 的依赖改成内容字段（`[name, classroom, teacher, parityLabel, note]`） | 长任务 54–156ms，最大帧间隔 67–300ms | 去掉「每 render 重测」能消掉大头，但仍不达标 ⇒ 逐格读写交错是第二层原因 | `experiment-dependencies.json` |
| E4 | 再引入共享队列 + 分阶段批量读写（`cellLayout.ts`） | **无 ≥50ms 长任务**，最大帧间隔 33.5–50ms（多次复跑），切周与结束态断言全绿 | 达标（AC1） | `after-batch-cpu1.json` |
| E5 | 压力对照 rate=4 | 长任务 73–134ms，最大帧间隔 83–133ms；方向与终态仍正确 | 4 倍降速下的残留是宿主 CPU 噪声级开销，**不当真机结论**，只作为改善比例的对照 | `after-batch-cpu4.json` |

### 修复前后的同一循环（rate=1）

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 松手后最大帧间隔 | 1083–1317ms | **33.5–50ms（多次复跑）** |
| 松手后最长主线程任务 | 672–824ms | **0（无 ≥50ms 长任务）** |
| 一次手势切周数 / 结束态 | 1 / idle | 1 / idle |

## 3. 课程格适配回归（AC3）

`verify-cell-layout.mjs` + `run-cell-layout-verify.sh`：360×794、412×731、1440×900 三个视口，
手机端各跑 1x 与 2x（含「切一周后再测」），逐格断言教室恒显、可丢行顺序不倒挂、
字号在 8–15px、文字块不宽于容器且不水平溢出、内容溢出必须已走兜底。

读数：三视口 **violations = []**（`cell-layout.360x794` / `cell-layout.412x731` / `cell-layout.1440x900`）。
手机端 2x 的 `scrollerOverflowX` 327 / 379px 属于缩放档位的既有设计（2x 列宽 = 容器 2 倍，可横向滚动），不是回归。

## 4. 未验证范围（如实列出）

- **原生 WebView 未复核**。本机沙盒里 `/home/yetongy/.gradle` 是只读挂载，Gradle wrapper 无法建锁文件；
  改用 `GRADLE_USER_HOME=/tmp/...` + 只读依赖缓存后，`assembleDebug` 因沙盒无 DNS（`dl.google.com` /
  `repo.maven.apache.org` 解析失败）无法解析 Kotlin 插件而失败。因此**没有**产出装载本次改动的 APK。
  仓库内现存的 `app-debug.apk` 是改动前的资产，装它不能验证本次修复。
- **用户设备未测**。用户手机型号 / WebView 版本未知；上面的读数只能说明「同一段代码路径在桌面 Chrome 上
  从 1.0–1.3s 停顿降到无长任务」，不能替代真机结论。
- `min-h-full`（`ceef1b9`）与滚动链未改动，其兼容性由既有守卫（`scheduleSourceGuard.test.ts`、
  `pnpm webview:check-css`）与本次门禁覆盖，本次没有重跑旧引擎镜像。

## 5. 复现要点（不写入本机路径）

1. `pnpm build` 后用静态服务器托管 `build/client`（`ssr: false` 的 SPA）。
2. `agent-browser --executable-path /usr/bin/google-chrome open <url>`，`set viewport 412 731 2`。
3. 种子必须走 `storage local set` 再紧接 `reload`（运行中的应用会把内存状态回写覆盖直接 `eval` 写入的值）。
4. CDP 连接用 **page** target 的 `webSocketDebuggerUrl`；`Emulation.setCPUThrottlingRate` 只在需要压力对照时设 4。
5. 松手时刻靠页面内的 `touchend` 监听打点，比在 Node 侧估时要准；`longtask` 必须在页面内起
   `PerformanceObserver`，事后补不了。
6. headless 下 `document.visibilityState` 与 rAF 节流会干扰判定：脚本已用 `Page.bringToFront` +
   `Emulation.setFocusEmulationEnabled` 固定，否则会出现「切周已完成但状态停在 `switching`」的假象。
