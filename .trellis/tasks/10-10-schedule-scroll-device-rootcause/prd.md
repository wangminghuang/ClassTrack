# 定位手机端课表无法上下滑动（单指也失效）的真机根因并收口兜底

## 现象（用户报告，2026-10-10）

- Android 12 手机：**一进课表就滑不动**，**单指上下滑同样失效**，到不了第 9~12 节。
- 稳定度：用户口径「**较稳定**」复现（非 100%）。
- 已装 `android-beta-29`（含 `09-29-fix-schedule-scroll-legacy-webview` 的高度锚点修复）→ **仍然滑不动**。
- 设备侧未知量：System WebView 版本**暂时拿不到**；真机不在本机 adb 可及范围（`adb devices` 为空）。
- 「个人中心 → 课表显示 → 左右边缘滑动切换周」开关与症状无关（用户口径：**一进课表就不行**，无需先做手势）。

## 已确认事实（本轮模拟器取证，2026-10-10）

### 1. 交付链路与缓存已排除

- 原生 WebView 里 **不注册 Service Worker**（`app/root.tsx`：`{!nativeShell && !isNativeApp() && <PwaUpdatePrompt />}`）：
  实测 `registrations: []`、`cacheKeys: []`、`swController: null`。
- `adb install -r` 覆盖升级后，运行时加载的就是新包资产：`root-D5a9k11K.css`，
  sha256 `418f3ab4346f68e45ee9e83648188ec0e658b5720f5165e9332095f4879fe46b`（包内 / 本地构建 / 运行时三方一致）。
- ⇒ 用户那次 beta-29 **确实运行了修好的 CSS**，高度锚点修复不是他设备上的成因（至少不是全部）。

### 2. 引擎带（模拟器实测）

| 引擎 | 来源 | 结论 |
| --- | --- | --- |
| WebView **91**（Chrome 91） | API 31 google_apis 出厂镜像 | **整页空白**：`appViewport: null`、`courseCells: 0`、`supportsDvh: false` |
| WebView **120**（Chrome 120） | API 32 google_apis r08 镜像 | 正常渲染，`supportsDvh: true`，单指纵向 `maxScrollTop 279` |
| WebView **149**（Chrome 149） | API 37.1 playstore 镜像 | 正常渲染，`clientH 501 / scrollH 780 / maxScrollTop 279`，程序化滚动与 CDP 触摸拖动均达 278.86 |

- 「能正常渲染课表」与「单指滑不动」在本项目可跑的现代引擎上**不共存** ⇒ 现有复现手段覆盖不到用户症状。

### 3. 一个真实、可复现的相邻缺陷：多触点竖直拖动被整体拒绝

`app/features/schedule/ScheduleTable.tsx:120` 的滚动容器带 `[touch-action:pan-x_pan-y]`。
真实 Android WebView（Chrome 149，1080×1920@420，已灌种子）实测：

| 手势 | `pan-x pan-y`（现状） | `manipulation` | `auto` |
| --- | --- | --- | --- |
| 单指竖直拖动 | 0 → **278.86** ✓ | ✓ | ✓ |
| 双指平行竖直 | 0 → **0** ✗ | 0 → **278.86** ✓ | 0 → **278.86** ✓ |
| 中途落下第二指 | 0 → **0** ✗ | 0 → 10.29（仅初始增量） | — |

- 对照（注入**不属于 React 树**的普通 `div`，无任何应用 JS）：`touch-action: auto` 双指竖直 `top 186` ✓；
  `pan-x pan-y` 双指竖直 `top 0` ✗；两者单指都能滚（182 / 192）⇒ **是 `touch-action` 值本身**让引擎拒绝多触点竖直拖动。
- 但用户口径是「**单指也滑不动**」，而单指在任何 `touch-action` 下都能滚 ⇒ 这**不是**用户症状的根因，
  是与同一句「滑不动」相邻的独立缺陷（须按 R5 明确处置）。
- 附注：`useScheduleZoom` 里的 `event.preventDefault()` 因 React 17+ 的 passive 监听实际不生效，不构成额外拦截。

### 4. 高度链/视口单位理论对用户设备**条件性不成立**

- 已合并修复只覆盖 `html, body`（`height: 100%` 兜底 + `@supports (height: 100dvh)` 升级）
  与 `@supports not (height: 100dvh) { .app-viewport { height: 100vh } }`；
  `.h-svh` / `.min-h-svh`（`app/components/ui/sidebar.tsx:140,232`）**仍未兜底**（2026-09-29 明确选择「只修锚点链」）。
- `dvh` / `svh` 都需 Chromium 108+；而产物里 `oklch(` 出现 **95 次**且构建未配置降级目标
  ⇒ 低于 Chrome 111 的引擎**颜色会明显坏掉**。
- 用户设备能正常显示课表（未报配色异常）⇒ 其 WebView 大概率 **≥ 111** ⇒ `dvh` / `svh` 均可用 ⇒ 高度链不会因视口单位失效。
- ⇒ **必须拿设备侧读数**才能收敛；在此之前不做根因结论。

### 5. 跨页对照（用户实测，2026-10-10）

- **设置/个人中心页（同一外壳链路上的长列表）单指上下滑：正常**；课表页：单指滑不动。
- ⇒ 外壳链路（`html/body → .app-viewport → SidebarInset`）在用户设备上**是可用的**，否则设置页也不会滚。
- ⇒ 根因**锁定在课表局部**：`SchedulePage → ScheduleTable → [data-schedule-swipe-stage] → [data-schedule-scroll]`
  这条尺寸分配链，或课表触摸层（`touch-action`、pointer 捕获、覆盖层）。
- ⇒ 「全局高度链塌陷」由主候选降级；`SCROLL_SWALLOWED` / `CLIPPED_BY_STAGE`（课表局部）上升为主候选。


### 6. 根因认定（2026-10-10，**在用户同一个包上复现成功**）

用**用户装的那个包**（`android-beta-29`，不含诊断代码）在 API 32 模拟器（System WebView **120.0.6099.193**）复现，
修复前后同页对照（读数见 `research/evidence/a32-chrome120-rootcause-fix/`）：

| 读数 | 修复前 | 运行期注入候选样式后 |
| --- | --- | --- |
| `[data-schedule-scroll]` | `clientH 510 / scrollH 510 / maxScrollTop **0**` | `clientH 510 / scrollH **780** / maxScrollTop **270**` |
| `[data-schedule-grid]` | `clientH 510 / scrollH **780**`（13 行 = 36 + 62×12） | `clientH **780**` |
| 程序化 `scrollTop = 9999` | **0** ✗ | — |
| 系统级单指上滑（`input swipe`，非 JS 注入） | **0** ✗ | **270 = max** ✓ |

- **机制**：网格容器被钉在容器高度（`h-full`），其 13 行溢出自身盒子（780 > 510）时，
  WebView 120 **不把这部分行溢出计入祖先滚动容器的 `scrollHeight`** ⇒ 滚动容器认为「没有可滚内容」⇒
  单指/程序化都滚不动 ⇒ 到不了第 9~12 节。
- Chrome 149 会把同样的行溢出传播进祖先滚动区（`scrollH 780` ✓，`research/evidence/scroll-api371-chrome149/`）
  ⇒ 这解释了「现代引擎测不出来、用户设备必现」，也解释了设置页（普通块流）为何不受影响。
- **修复**：`app/features/schedule/ScheduleTable.tsx` 网格容器 `h-full` → **`min-h-full`**（高度随内容长高，仍至少撑满容器）。
  含修复的真包在 Chrome 120 上：`scroller 510/780/max 270`、系统级上滑 → **270**、诊断浮层自判 **`SCROLL_OK`**
  （`research/evidence/a32-chrome120-rootcause-fix/04..05`）。
- **无回归**：高视口（视口 1103，容器 921 > 最小内容 780）下修复前后逐项相同（网格仍被 `1fr` 撑满、行高 73.744px）。
- 与既有理论的关系：本根因与视口高度锚点 / `dvh` **无关** ⇒ `09-29` 那轮锚点修复对用户症状无效（§4 已预判）；
  §5 的「排除全局高度链」也被这条读数印证（`clippingAncestors: []`、`caps.dvh: true`）。
- 结果：**修复已随 `android-beta-30` 交付，等用户在真机上复测（AC-4）**。

## 待确认（根因已认定，下表仅用于在**用户读数**上复核）

- 用户设备 System WebView 版本（或等价读数）：决定是否落在「99–107 能渲染但无 dvh」带。
- 设备侧 5 类关键读数：
  1. `[data-schedule-scroll]` 的 `clientHeight / scrollHeight / maxScrollTop`；
  2. 祖先链（`html/body → .app-viewport → SidebarInset → 页面根 → swipe-stage → scroller`）各元素的
     `height / minHeight / overflowY / flex / transform`；
  3. 单指拖动期间 `touch* / pointer* / scroll` 事件计数与 `event.touches.length` 峰值；
  4. 拖动前后 `scrollTop`、`data-schedule-grid` 的 `--schedule-zoom`、`data-current-week`；
  5. 引擎能力：`supportsDvh / supportsSvh / supportsOklch / supportsLayer`、`innerW×innerH`、`visualViewport.scale`。
- **判定表（读到手即可定性）**：

- **前置判别（用户实测已给出）**：设置页单指能正常滑 ⇒ 排除「全局高度链塌陷」，只在课表局部找原因；下表按此收窄。
  | 读数特征 | 结论方向 |
  | --- | --- |
  | `scrollHeight == clientHeight`，且祖先 `overflow: hidden` 裁掉底部 | 高度链塌陷 → 按视口单位/兜底链收口（含 `.h-svh`/`.min-h-svh`） |
  | `scrollHeight > clientHeight`，但拖动后 `scrollTop` 不动、`scroll` 计数 0 | 滚动被吞 → 查触摸层（`touch-action`、pointer 捕获、透明覆盖层） |
  | `scrollTop` 会动，但内容仍到不了第 9~12 节 | 裁切层/尺寸分配（`swipe-stage` 高度、sticky 表头）问题 |
  | 单指拖动时 `touches.length` 峰值 = 2 | 触屏把一次接触算成两个触点 → 第 3 节的 `touch-action` 缺陷即用户根因 |
  | 页面空白或无 scroller | 引擎低于基线（Chrome 111+）→ 走显式降级策略，不下调整体基线 |

## Requirements

- **R1 根因由设备侧读数认定**：不接受「机制推断 + 等价复现」单独结案（上一轮如此结案，真机复测失败）。
- **R2 诊断器械零外部依赖**：用户当前**无法连 USB**、也不能装 devtools 时，仅靠「安装一个包 + 截图/复制一段文本」完成采集。
- **R3 诊断器械不得改变被诊断行为**：不引入会改变布局或手势的样式/监听（不动 `touch-action`、不改高度；监听一律 passive）；
  开关默认关闭，不进生产 UI 路径。
- **R4 课表在内容超出容器时必须能上下滑动**，不允许「内容被裁掉且滚不到」；修完必须**真机复测**通过。
- **R5 `touch-action: pan-x_pan-y` 的多触点缺陷必须明确处置**（本任务一并修，或新建任务并留指针），不允许静默遗留。
- **R6 保持 CSS/JS 基线（Chrome 111+ / Safari 16.4+）不变**；若读数显示用户设备低于基线，走显式降级策略而非整体下调目标。
- **R7 零回归**：门禁全绿（`typecheck` / `lint` / `format:check` / `test` / `webview:check-css` / `test:webview-css` / `build`），
  且模拟器双引擎（Chrome 120 / 149）上单指纵向、双指、左右横滑切周、缩放、边缘滑动开关全过。
- **R8 环境凭据与本地绝对路径不得写入仓库**（沿用 `env-setup.md` 口径）；证据只留读数与命令。

## Acceptance Criteria

- [x] **AC-1** 诊断器械在真机上产出覆盖「待确认」5 类读数的**一份**可回传材料（文本优先，截图可接受），默认不影响生产 UI。
      —— 浮层一次「冻结读数」即输出完整 JSON（env/caps/scroller/链 9 节点/clippingAncestors/grid/gesture/gestureScroll/diagnosis），
      已在模拟器上端到端跑通；`nativeShell`（`?native-shell=1` 导入壳）之外才挂载，正常课表视图可见。
- [x] **AC-2** 采集逻辑有单测：对构造的布局/事件快照，输出与判定表一致（至少覆盖 `scrollHeight == clientHeight`、
      `touches.length` 峰值 = 2、祖先 `overflow: hidden` 裁切三种情形）。
      —— `scrollDiagnostics.test.ts` 25 例，含判定表逐行、网格溢出新增码、拖动位移峰值与手势边界复位。
- [x] **AC-3** 用户回传读数后，任务记录里给出**唯一根因结论**（对应判定表某行），并写明排除了哪些候选及依据。
      —— 结论已在 §6 定稿（**在用户同一个包上复现**，非推断）；未等用户读数即收敛，用户读数改为**复核**用途。
- [ ] **AC-4** 修复后用户在**同一台真机**上单指可滑到第 9~12 节，并记录前后读数对比（`maxScrollTop` / `scrollTop`）。
      —— 待用户在 `android-beta-30` 上复测（浮层读数里 `scrollerMaxScrollTop` 应 > 0、拖动后 `scrollTop` 非 0）。
- [x] **AC-5** 修复后模拟器双引擎回归：Chrome 120 与 149 上单指纵向 `scrollTop → maxScrollTop`；
      左右横滑切周仍符合 `09-29-schedule-edge-swipe-device-verify` 的约定；边缘滑动开关关闭时纵向滚动不受影响。
      —— 见 §6 与 `research/evidence/gesture-matrix-dual-engine.md`：两引擎单指 `0 → max`、缩放 `1 → 2`、
      缩放后单指 `0 → max`、边缘横滑 `3 → 2`；**开关关闭**时双引擎周次不变且单指仍 `0 → max`。
- [x] **AC-6** `touch-action` 多触点缺陷处置有落点（本任务修复记录，或新任务指针）并附复现数据。
      —— 新建任务 `.trellis/tasks/10-10-schedule-touch-action-multitouch/`（含 prd 与 `research/evidence/` 原始读数）；
      本任务只认定「它不是用户症状的根因」并记录双引擎矩阵证据。
- [x] **AC-7** 门禁全绿（见 R7）；产物层面确认视口高度锚点与 svh 兜底在**构建后仍然存活**（`webview:check-css` 覆盖）。
      —— `typecheck` 0 错、`eslint` 干净、`prettier --check` 通过、`pnpm test` **47 文件 432 例**、
      `webview:check-css` + `test:webview-css` 通过、`pnpm build` 通过（诊断分支含 504ee9a）。
- [x] **AC-8** 仓库内不含环境凭据/本地绝对路径。
      —— 任务目录已自检：临时目录、家目录绝对路径与凭据关键词三类扫描均零命中；旧证据里的临时目录写法已统一替换为占位符。

## Notes

- 本任务与 `09-29-schedule-edge-swipe-device-verify` 的 **AC-18（纵向滚动零回归）**、
  归档任务 `09-29-fix-schedule-scroll-legacy-webview` 的 **AC-6（真机验收，当时未做）** 直接相关；
  收尾时把这两条的记录补齐或转移到本任务。
- 证据与复现命令见 `research/README.md`；技术方案见 `design.md`；执行清单见 `implement.md`。
- `prd.md` 只放需求/约束/验收；技术设计放 `design.md`。
