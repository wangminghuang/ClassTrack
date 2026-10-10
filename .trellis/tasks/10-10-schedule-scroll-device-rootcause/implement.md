# 执行清单：设备侧诊断 → 定根因 → 收口

> 状态（2026-10-10）：**P1–P5（模拟器部分）已完成**，修复随 `android-beta-30` 交付；
> 剩 P5 的真机复测（用户）与 P6 收口。分支安排：**修复直接在 `master`**（`ceef1b9`），
> 诊断浮层走 `diag/schedule-scroll-readout`（`504ee9a`）出包，master 不含诊断代码。

## P0 复现与排除（已完成，2026-10-10）

- [x] 交付链路/缓存排除：SW 不注册、`install -r` 后运行时 CSS = 新包 CSS（hash 三方一致）。
- [x] 引擎带取证：WebView 91 整页空白；WebView 120 / 149 能正常渲染。
- [x] 多触点缺陷复现：`[touch-action:pan-x_pan-y]` 让双指竖直拖动完全不滚（对照容器 + 运行时替换为
      `manipulation` / `auto` 后恢复 278.86）。
- [x] 结论边界记录：用户「单指也滑不动」⇒ 多触点缺陷不是他的根因。
- [x] **（补）在用户同一个包上复现**：API 32（WebView 120）上「网格行溢出未进祖先滚动区」⇒ 单指与程序化均滚不动。
- 证据：`research/README.md`、`research/evidence/`（含 `a32-chrome120-rootcause-fix/`）。

## P1 诊断器械（代码 + 单测）——已完成

- [x] 诊断分支 `diag/schedule-scroll-readout`（从 master 切出，只在此分支加浮层）。
- [x] `collectScrollDiagnostics(win, doc, observed?)`：纯读取、依赖注入，字段与 `design.md` §2.2 一致。
- [x] `verdictHints(snapshot)`：覆盖 §2.4 判定表，并**新增** `GRID_OVERFLOW_NOT_SCROLLABLE`
      （网格行溢出自身盒子但未进祖先滚动区）——避免把用户状态误判成 `CONTENT_FITS`。
- [x] 面板：`ScheduleScrollDiagnosticsPanel` 全局挂载（`nativeShell` 之外），
      「冻结读数 / 重新开始记录 / 全选复制」；`DIAGNOSTICS_ENABLED_BY_DEFAULT` 在诊断分支为 `true`
      （原生应用里用户改不了 URL，故靠**分支**隔离，master 恒 `false`）。
- [x] 计数监听全部 `{ passive: true }`；记录 `event.touches.length` 峰值与**每次手势的**竖直位移峰值
      （手势结束即复位起点，否则两次拖动会被累加成假位移）。
- [x] 浮层高度收敛到 `max-h-[34vh]`：用户必须在浮层**上方**滑动，58vh 时真机上只剩 291px，滑动会整段落进浮层。
- [x] 单测（AC-2）：**25 例**（判定表逐行、网格溢出新码、拖动位移峰值与复位、监听器硬约束）。
- [x] 门禁：`typecheck` / `eslint` / `prettier` / `pnpm test`（**47 文件 432 例**）全绿。
- [x] 自检：模拟器上端到端跑通，读数与 `09-29-*` 落库探针同量级。

## P2 出诊断包并取数（用户动作）——已交付

- [x] CI 出 `android-beta-30`（含**修复 + 浮层**，正文说明两者都在）。
- [x] 交付三步：① 打开课表 ② **在浮层上方的课表区域**单指从下往上滑两次 ③ 点「冻结读数」后截图或全选复制回传。
- [x] 附加提示：方便时在**个人中心/设置页**做一次同样的单指上滑（跨页对照）。
- [ ] 回传材料存入 `research/evidence/`（去掉任何设备标识/凭据）。

## P3 判定根因（Phase 2 的门）——已完成（**未等用户读数**）

- [x] 唯一结论：**网格容器被钉在容器高度（`h-full`），其行溢出未被计入祖先滚动容器的 `scrollHeight`**
      （`prd.md` §6；判定表新增行，等价于「`scrollHeight == clientHeight` 但内容确实溢出」）。
- [x] 排除的候选：全局高度链塌陷（设置页能滚 + `caps.dvh: true` + `clippingAncestors: []`）、
      触摸层吞事件（`touch`/`pointer` 事件数与位移都正常）、`touch-action` 多触点缺陷（单指也失效）。
- [x] 引擎带：用户设备能正常显示课表 ⇒ 不低于 Chrome 111；本根因在 WebView 120 上**实测**复现，与该带一致。
- [x] 用户读数改为**复核**用途（见 prd「待确认」节），不再是结案前提。

## P4 修复（按 P3 结论）——已完成

- [x] 最小面改动：`app/features/schedule/ScheduleTable.tsx` 网格容器 `h-full` → **`min-h-full`**（高度随内容长高）。
      （原清单里的两条分支 `HEIGHT_CHAIN_COLLAPSE` / `MULTI_TOUCH_CONTACT` 均**不是**本次根因，故未动。）
- [x] 源码守卫单测：`scheduleSourceGuard.test.ts` 断言网格节点为 `min-h-full` 且 12 行模板仍在（防止改回 `h-full`）。
- [x] 「能滚到最后一节」的等价断言：真包上系统级单指上滑必须到达 `maxScrollTop`（Chrome 120：`0 → 270 = max`）。
- [x] 门禁：`typecheck` / `eslint` / `prettier` / `test`（46 文件 407 例，master 侧）/ `build` / `webview:check-css` / `test:webview-css` 全绿。
- [x] 产物复核：构建后 CSS 里 `html,body` 兜底 + `@supports (height:100dvh)` 升级块**都还在**。

## P5 回归（器械 + 真机）

- [x] 模拟器双引擎回归（AC-5，见 `research/evidence/gesture-matrix-dual-engine.md`）：
      - 单指竖直：Chrome 120 `0 → 270.1`、Chrome 149 `0 → 278.9`（系统级 `input swipe` 均到达 `maxScrollTop`）；
      - 双指竖直 / 中途落第二指：两引擎均 `0 → 0`（**已知独立缺陷**，已由新任务承接）；
      - 左右横滑切周：`data-current-week 3 → 2`（两引擎）；
      - 缩放：`--schedule-zoom 1 → 2`，缩放后单指仍 `0 → max`；
      - 关掉「左右边缘滑动切换周」：边缘横滑不再切周，且单指仍 `0 → max`（两引擎）。
- [x] 高视口无回归：视口 1103 / 容器 921 > 最小内容 780 时，修复前后逐项相同（`1fr` 撑满、行高 73.744px）。
- [ ] 真机复测（用户，AC-4）：同一台设备、`android-beta-30`，单指滑到第 9~12 节；记录前后 `maxScrollTop` / `scrollTop`。
- [x] 「修复前 / 修复后」读数已存 `research/evidence/a32-chrome120-rootcause-fix/`（截图另见运行目录，不入库）。

## P6 收口

- [ ] `09-29-schedule-edge-swipe-device-verify` 的 **AC-18** 与本任务 AC-4/AC-5 合并记录（避免两处口径分叉）。
- [ ] 归档任务 `09-29-fix-schedule-scroll-legacy-webview` 的 **AC-6** 标注「由本任务承接」。
- [ ] spec 更新（`trellis-update-spec`）：
      - `.trellis/spec/frontend/quality-guidelines.md`：新增「滚动容器内的网格**不得**钉在容器高度」契约
        （`min-h-full` 而非 `h-full`），并把视口高度锚点条目按实际结论收敛；
      - `.trellis/spec/frontend/mobile-schedule-layout.md`：增补「多触点竖直拖动 / `touch-action` 取值」约定与验收配方
        （含「拖动起点必须落在诊断浮层上方」这类取证坑）。
- [ ] 会话日志与验收记录落库；`git status` 干净后提交。

## 回滚点

| 阶段 | 回滚动作 |
| --- | --- |
| P1/P2 诊断包 | 删诊断分支与 `android-beta-30` 标签；master 不含诊断代码，不受影响 |
| P4 修复（`min-h-full`） | `git revert ceef1b9`（单提交，含守卫单测一起回退） |
| P5 发现回归 | 回退到 `ceef1b9` 前一提交，重新按读数评估 |
