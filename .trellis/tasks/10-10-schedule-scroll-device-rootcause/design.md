# 技术设计：设备侧课表滚动诊断与收口

## 0. 设计目标

在「无法连 USB、拿不到 WebView 版本、复现不了症状」的前提下，把根因认定从**推断**变成**读数**，
并让修复范围由读数决定，而不是先修再验。

## 1. 为什么是这个方案

| 备选 | 为什么不用 |
| --- | --- |
| 用户查 WebView 版本后按版本带推进 | 只给「是否 99–107」一个 bit；仍无法区分「高度链塌陷」与「滚动被吞」，且用户暂时拿不到 |
| 让用户连 USB 用 CDP 量 | 用户当前不具备条件；且 release 包 devtools 关闭 |
| 再在模拟器上换引擎复现 | 已跑 WebView 91 / 120 / 149：91 整页空白，120/149 单指都正常 ⇒ 覆盖不到 |
| 直接按最可能的假设改代码再发包 | 上一轮就是这样（锚点修复 + beta-29）→ 真机复测失败，代价是一整轮；本任务不接受同样的赌法 |

结论：**把诊断器械随包下发**，用一次安装 + 一次截图把 5 类读数一次性取回。

## 2. 诊断器械：`schedule-scroll` 诊断面板

### 2.1 触发与隔离

- **全局浮层**：任意路由下只要 URL 带 `?diag=schedule-scroll` 就挂载一个固定定位的诊断浮层
  （`position: fixed`、独立于页面布局），未带参数时**不渲染任何节点、不注册任何监听**（满足 R3）。
  做成全局而非课表页内，是为了能在**设置页**跑同一份读数做跨页对照（用户 2026-10-10 实测：设置页单指能正常滑）。
- 交付方式：从 `master` 拉诊断分支，只带这一处新增；经 CI 出 `android-beta` 包（命名标注 diag），
  验证完即删分支/不合并；master 不因诊断留痕（若最终决定保留，必须默认关闭且有单测证明零开销）。

### 2.2 采集内容（一次性快照 + 手势期间计数）

```ts
type ScrollDiagnostics = {
  env: { ua: string; innerW: number; innerH: number; dpr: number; visualScale: number | null }
  caps: { dvh: boolean; svh: boolean; oklch: boolean; layer: boolean; dvhUnitApplied: boolean }
  chain: Array<{ sel: string; height: string; minHeight: string; overflowY: string; flex: string; display: string; transform: string; touchAction: string; clientH: number; scrollH: number }>
  scroller: { found: boolean; clientH: number; scrollH: number; maxScrollTop: number; scrollTop: number; scrollLeft: number; touchAction: string } | null
  grid: { found: boolean; zoom: string; currentWeek: string | null; rowCount: number }
  gesture: { touchStart: number; touchMove: number; touchEnd: number; pointerDown: number; pointerMove: number; scroll: number; maxTouches: number; maxPointers: number; scrollTopBefore: number; scrollTopAfter: number }
  verdictHints: string[]   // 判定表命中的行（见 2.4）
}
```

- `chain` 固定抓这些节点（缺失即 `found:false`）：`html`、`body`、`.app-viewport`、
  SidebarInset（`[data-slot="sidebar-inset"]` 或类名匹配）、页面根（`[data-schedule-page]`，缺失则用 `main`）、
  `[data-schedule-swipe-stage]`、`[data-schedule-scroll]`、`[data-schedule-grid]`。
- `caps.oklch` / `caps.layer` 用 `CSS.supports` 判定；`caps.dvhUnitApplied` 用
  `getComputedStyle(document.documentElement).height` 与 `innerHeight` 的关系推断（避免只信 `@supports`）。
- `gesture.maxTouches` 用 `touchstart/touchmove` 的 `event.touches.length` 峰值（默认 1，若为 2 则命中判定表第 4 行）。
- 计数监听挂在 `window`（`{ passive: true }`），只在面板打开时注册；读数按钮冻结快照。

### 2.3 采集逻辑的纯函数化（可测）

- `collectScrollDiagnostics(win, doc)` 为纯读取函数（依赖注入 `win`/`doc`），面板只负责渲染与冻结。
- 单测用 jsdom + 构造的 DOM/布局桩覆盖三种判定情形（AC-2）；不依赖真实引擎。

### 2.4 判定表（器械内提示 + 任务记录用）

| 条件 | `verdictHints` |
| --- | --- |
| `scroller.maxScrollTop === 0 && 存在祖先 overflowY === 'hidden' && 祖先 clientH < scroller.scrollH` | `HEIGHT_CHAIN_COLLAPSE` |
| **`grid.scrollH - grid.clientH > maxScrollTop + 1`**（网格行溢出自身盒子，却没进祖先滚动区） | **`GRID_OVERFLOW_NOT_SCROLLABLE`**（本任务新增，**用户设备实际命中**） |
| `scroller.maxScrollTop > 0 && gesture.maxTouches === 1 && gesture.scroll === 0 && ΔscrollTop === 0` | `SCROLL_SWALLOWED` |
| `scroller.maxScrollTop > 0 && ΔscrollTop > 0 && 到不了第 9~12 节` | `CLIPPED_BY_STAGE` |
| `gesture.maxTouches >= 2` | `MULTI_TOUCH_CONTACT`（指向 `touch-action` 缺陷） |
| `!scroller.found` 或 `chain[html].height === 'auto'` 且页面空白 | `ENGINE_BELOW_BASELINE` |

### 2.5 回传方式

- 面板把快照渲染成 `<textarea readonly>` + 一键 `select()`（不依赖剪贴板权限），并显示「按 ①②③ 操作」的步骤提示：
  ① 打开课表面板 ② 单指从下往上滑两次 ③ 截图或全选复制。
- JSON 同时写入 `localStorage['class-track:scroll-diag']`，便于用户之后再次打开面板时对比。

## 3. 修复方向（**由读数选择**，不在读到手之前写死）

> **实际结论（2026-10-10）**：命中 §2.4 新增行 `GRID_OVERFLOW_NOT_SCROLLABLE`，
> 对应下面**新增的那一行**修复方向：网格容器 `h-full` → `min-h-full`（高度随内容长高）。
> 已落地并验证：Chrome 120 上 `scroller 510/780/max 270`、系统级单指上滑到达 `maxScrollTop`、
> 高视口行为与修复前逐项相同；提交 `ceef1b9`，守卫单测在 `scheduleSourceGuard.test.ts`。

| 判定 | 修复方向 | 备注 |
| --- | --- | --- |
| `HEIGHT_CHAIN_COLLAPSE` | 收口 `.h-svh` / `.min-h-svh` 的 `100vh` 兜底（与已合并的 `html/body` 兜底同构），并扩充 `scripts/check-webview-css-fallback.js` 的守卫范围 | 与 2026-09-29 的「只修锚点链」决定一致延伸；spec 已把这两条标为「未兜底」 |
| **`GRID_OVERFLOW_NOT_SCROLLABLE`**（新增） | 把滚动容器内的高度钉死改成「随内容长高」：`app/features/schedule/ScheduleTable.tsx` 网格容器 `grid h-full` → `grid min-h-full` | **本次实际采用**；旧版 WebView（120 实测）不会把钉死容器的行溢出计入祖先 `scrollHeight`，改后祖先可滚；高视口由 `min-h` 保证仍撑满，行为不变 |
| `SCROLL_SWALLOWED` | 定位吞掉滚动的层：候选 `touch-action`、pointer 捕获、透明覆盖层；按证据改最小面 | 若与多触点有关则与下一行合并 |
| `MULTI_TOUCH_CONTACT` | 把滚动容器 `[touch-action:pan-x_pan-y]` 改为 `manipulation`（保留应用内双指缩放），并确认 WebView 自身缩放已关闭（Capacitor 默认） | 已实测：`manipulation` 下双指竖直可滚（278.86），单指不变 |
| `CLIPPED_BY_STAGE` | 修尺寸分配（swipe-stage 高度 / sticky 表头 / `min-h-0` 链） | 需补一条“能滚到最后一节”的断言 |
| `ENGINE_BELOW_BASELINE` | 显式降级策略（能力探测 + 提示/降级样式），不下调整体基线 | 产物 `oklch` 95 处、无降级目标；需单独评估 |

## 4. 影响面与兼容

- 诊断面板：新增文件 + 一处受参数保护的挂载点；不合并到 master 时对生产零影响。
- 修复（任一方向）：改的是 CSS 类/属性或单点手势代码，不改数据模型、不改 store、不改原生层。
- 兼容：所有修复都必须在「支持 dvh 的引擎」上保持原语义（用 `@supports` 或既有兜底结构表达），
  并在 Chrome 120 / 149 双引擎回归。

## 5. 回滚

- 诊断包：删分支/标签即回滚，不触碰 master。
- 修复：单提交改动，`git revert` 即可；CSS 兜底类改动与守卫脚本改动分两个提交，便于分别回滚。

## 6. 验证器材（已有，可复用）

本轮器械是**本机临时脚本**（模拟器一键取证、CDP 跑手、布局探针、多点手势矩阵、对照容器实验），
含本机环境细节，按 R8 **不入库**；可长期复用的部分已作为研究器材留在仓库归档任务目录
（`09-29-fix-schedule-scroll-legacy-webview/research/`：`device-diagnostics.mjs`、`cdp-dvh-equivalent.mjs`、
`cdp-vertical-scroll-matrix.mjs`、`layout-probe.js`、`make-seed.mjs` 等）。

入库的只有**读数 JSON**（`research/evidence/`）与实验说明（`research/README.md`），以便复现与复核判定表。
