# 设计：恢复 `html, body` 的高度锚点（保留 `dvh` 升级）

> 需求与验收标准见 `prd.md`；证据与实测数字见 `research/dvh-fallback-evidence.md`。

## 1. 目标与不变量

**目标**：在忽略 `height: 100dvh` 的引擎（Chromium ≤ 107 / Safari < 15.4）上，`html, body` 仍有确定高度；
在支持 `dvh` 的引擎上仍取 `dvh`。满足后课表滚动容器恢复为「视口分配高度」，`maxScrollTop > 0`。

**不变量**（逐条都要在验收里守住）：

- **I1** `html, body { overflow: hidden }` 语义不变。
- **I2** 支持 `dvh` 的引擎上，最终生效值仍是 `height: 100dvh`（PWA 动态视口语义不丢）。
- **I3** `@apply bg-background text-foreground antialiased` 与 `prefers-color-scheme: dark` 的 `color-scheme` 块不变。
- **I4** 不引入 JS、不引入运行时开销、不改任何组件与类名。
- **I5** 412×915 与 1440×900 的布局基线不变（对齐 `research/dvh-fallback-evidence.md` §5）。

## 2. 方案（唯一保留）

```css
html,
body {
  @apply bg-background text-foreground antialiased;
  height: 100%;
  overflow: hidden;

  @media (prefers-color-scheme: dark) {
    color-scheme: dark;
  }
}

/* dvh 生效时覆盖成动态视口高度；不支持的引擎用上面那条 height:100%。
   **不能**写成同一规则里的两次 height 声明 —— lightningcss 会把前一条当冗余删掉。 */
@supports (height: 100dvh) {
  html,
  body {
    height: 100dvh;
  }
}
```

### 为什么必须是 `@supports`（实测依据）

`research/lightningcss-fallback-matrix.mjs` 的矩阵（lightningcss 1.32.0，仓库实际用的那一份）：

| 写法 | 默认 / chrome111 目标下的产物 | 结论 |
| --- | --- | --- |
| `height:100%` + `height:100dvh`（同规则，**现状**） | `height:100dvh` | 兜底被删 ❌ |
| `height:100%` + `@supports (height:100dvh){ height:100dvh }` | 两条都保留 | ✅ 采用 |
| `height:100vh` + `height:100dvh` | `height:100dvh` | 兜底被删 ❌ |
| `height:100dvh` + `height:100%`（颠倒） | `height:100%` | **dvh 被删**，现代引擎也退回 100% ❌ |
| `html{height:100%}` + `body{height:100dvh}`（拆选择器） | 两条都在 | 语义改变（两元素高度来源不一致）❌ |
| `height:100dvh` + `min-height:100%` | 两条都在 | `min-height:100%` 在 `auto` 父级上等于 `auto`，不解决问题 ❌ |

分界线扫描确认删兜底的阈值正好是 **Chrome 108**（= `dvh` 支持起点），且 **lightningcss 不会把「对目标恒真」的
`@supports` 展开或删掉** —— 这是本方案成立的关键前提，已实测。

## 2b. 预防性加固：外壳自带视口锚点（C2，2026-09-29 追加）

`html/body` 是**唯一**的高度锚点：任何原因让它失效（构建器再删一次兜底、将来有人改写、未知引擎行为），
都会重演本次故障。C2 让应用外壳自己再拿一个锚点，且只在**不支持 `dvh` 的引擎**上生效：

```css
@layer utilities {
  .app-viewport { /* 原样不动 */ }

  @supports not (height: 100dvh) {
    .app-viewport {
      height: 100vh;
      max-height: 100vh;
    }
  }
}
```

为什么是这个形状（都已实测）：

- 用 `@supports not (height: 100dvh)` 而不是在同规则里再写一条 `height: 100vh`：后者会被 lightningcss 按
  「被覆盖的冗余声明」删掉（与本次根因同一机制，见 §2 的矩阵）。
- 实测 lightningcss **不会**把「对目标恒假」的 `@supports not` 块优化掉 → 块能落进产物（由产物守卫断言）。
- 对支持 `dvh` 的引擎该块恒不生效 → 零影响（基线实测逐项不变）。
- 在不支持 `dvh` 的引擎上 `100vh` == WebView 高度，与「`html/body` 正常时的 `100%`」等价；同为 `@layer utilities`
  内后写的同优先级规则，层叠上自然覆盖 `.app-viewport` 原来的 `height: 100%` / `max-height: 100%`。

救援能力实测（`research/preventive-hardening-probe.mjs`，把 `html/body` 的 `height` 全部拿掉 = 修复前状态）：

| 场景（412×915） | `shellHeight` | `maxScrollTop` | 拖动后 `scrollTop` | 课程格 | 课名字号 |
| --- | --- | --- | --- | --- | --- |
| 锚点拿掉（= 修复前） | 963 | 0 | 0 | 49×121 | 10.5474px |
| 锚点拿掉 + **C2** | **915** | **48** | **48** | **47×121** | **10.1108px** |

## 3. 被否决的替代方案

| 方案 | 否决理由 |
| --- | --- |
| 把 lightningcss/Tailwind 浏览器目标下调到 `chrome 96` | 会改变整份 CSS 的降级产物（体积与声明形态），超出本次范围；用户已定「保持 111+ 基线」 |
| 给 `package.json` 加 `browserslist` | 同上，全局影响 |
| 只用 `100vh` 作高度 | 移动端浏览器 `vh` 是「大视口」，地址栏收起时会溢出；`dvh` 是当初的刻意选择 |
| 用 JS（`resize` / `visualViewport`）设高度 | 引入运行时复杂度与首帧闪烁，纯 CSS 可解 |
| 加 `@supports not (height:100dvh){…}` 反向块 | 语义冗余；且 `@supports` 本身不被支持的古内核会两边都落空 |
| 顺带修 `.h-svh` / `.min-h-svh` / 三处 `calc(100dvh…)` 对话框 | 用户明确本次只修 `html/body` 这条致命项（见 PRD Non-goals） |
| **A** 网格 `min-height`（=`48.75rem`） | 实测基线中性（只多出不可见的网格盒高 732 → 780），但**救不了**锚点丢失类（场景 4 仍 `maxScrollTop = 0`）—— 没有可复现的失败场景，属投机改动 |
| **B** 手势位移挪到裁剪层 | 能消除「滚动容器带 transform」这个移动端已知坑类，但用户已实测排除它是本次原因，且会改动刚上线未真机验证的手势层 → 推迟到真机验收后 |
| **E** 降低行最小值让 12 节不必滚动 | 会改视觉基线（违反 R4），并牵动 09-24 的字号尺度体系 → 不做 |
| 用 JS 在启动时补 `documentElement.style.height` | 引入运行时依赖与首帧抖动；纯 CSS 的 C2 已能覆盖同一失效类 |

## 4. 验收设计

### AC-1 产物/工具链断言（防回归，主实现）

`app/app.css` 是 CSS 文件、没法直接单测，但**根因是「写法 + 工具链策略」的组合**，所以两层都钉：

1. **vitest 单测（主，零新依赖）**：`app/appCssViewportAnchor.test.ts`（命中 `vitest.config.ts` 的
   `include: ['app/**/*.test.ts']`，因此 CI 的 `pnpm test` 必然会跑到）读取 `app/app.css` 源文件，断言：
   `html, body` 的规则体里**只有一条** `height` 声明且值为 `100%`（禁止同规则双写 —— 这正是本次根因的形态），
   且存在 `@supports (height: 100dvh)` 块、块内 `height` 为 `100dvh`。
   不引入 `lightningcss` 直依赖：pnpm 是严格 node_modules，`lightningcss` 只是 `@tailwindcss/vite` 的传递依赖，
   从 app 代码直接 import 会 `ERR_MODULE_NOT_FOUND`；「构建器会不会把它当冗余删掉」交给第 2 条按真产物判定，
   比在单测里复刻一遍编译更贴近真源。
2. **产物断言（第二道闸）**：仿 `scripts/check-android-assets.js` 的既有模式加
   `scripts/check-webview-css-fallback.js` + `node --test` 用例，读 `build/client/assets/*.css`
   断言兜底真的落进了产物；产物缺失时报「先跑 `pnpm build`」而不是静默跳过。

### AC-2 / AC-3 等价条件验收（器械已就绪）

`research/cdp-dvh-equivalent.mjs`：把页面里所有 `height: 100dvh` 声明从 CSSOM 里 `removeProperty` 掉
—— 这正是旧引擎「忽略该声明」的结果（不删整条规则，所以同一规则里的 `overflow:hidden` 仍然生效）。
**已在修复前跑通并复现缺陷**，因此它是一条被验证过的器械，不是纸面方案：

| 指标（412×915） | 修复前 · 正常引擎 | 修复前 · 等价旧引擎 | 修复后 · 等价旧引擎（期望） |
| --- | --- | --- | --- |
| `html/body` 计算高度 | 915px | **963px** | 915px |
| `[data-schedule-scroll]` clientHeight | 732 | **780** | 732 |
| `maxScrollTop` | 48 | **0** | > 0（≈48） |
| 纵向拖动后 `scrollTop` | 48 | **0（不动）** | 到达 `maxScrollTop` |
| 第 12 节底边 | 885（< 915） | 885 | ≤ `innerHeight` |

断言口径：`document.body.scrollHeight <= window.innerHeight`（内容不再被 `body{overflow:hidden}` 裁掉）、
`maxScrollTop > 0`、拖动后 `scrollTop === maxScrollTop`。

### AC-5 布局基线

`research/layout-probe.js` 在 412×915 与 1440×900 采数字，逐项对齐
`research/dvh-fallback-evidence.md` §5（容器尺寸、行列模板、字号、课程格尺寸与数量、缩放控件是否渲染）。

### AC-6 真机

装新 APK 到报告问题的 Android 12 设备上确认。本沙盒无 `/dev/kvm`、`~/.android` 只读，无法用模拟器
（同 `09-29-schedule-edge-swipe-device-verify` 的结论），因此这一条**必须由用户在设备上做**。

### AC-7 C2 加固（正常引擎零影响 + 锚点失效可救援）

器械：`research/preventive-hardening-probe.mjs`（一次跑 7 个场景：基线 / A 在正常引擎 / C2 注入在正常引擎 /
锚点被拿掉 / +A / +C2 / +A+C2，每个场景都做一次真实触摸纵向拖动）。判据：

- 正常引擎（场景 2）：`shellHeight` / `gridClientH` / `clientH` / `maxScrollTop` / 课程格尺寸 / 字号
  与基线逐项相同；
- 锚点被拿掉 + C2（场景 5）：`maxScrollTop > 0`、拖动后 `scrollTop === maxScrollTop`、
  `shellHeight === innerHeight`、课程格与字号回到基线值；
- 产物侧：`pnpm webview:check-css` 断言 `@supports not (height: 100dvh)` 块仍在产物里。

### AC-8 设备诊断器械（D）

`research/device-diagnostics.mjs`：给一个 CDP ws url 就连上去输出判定；`--print-snippet` 打印同样的
自包含表达式，便于直接贴进 WebView devtools。输出包含：

- `navigator.userAgent` 里的 `Chrome/xxx`（判断是否 < 108）；
- 高度锚点链：`html` / `body` / `.app-viewport` 的 computed height 与 `window.innerHeight`；
- 滚动容器：`clientHeight` / `scrollHeight` / `maxScrollTop` / `scrollTop` / `scrollLeft`；
- 祖先链逐层的 `touch-action` / `overflow-y` / 内联 `transform`；
- **程序化滚动对照**：把 `scrollTop` 置为 `maxScrollTop` 再读回；
- 内容是否被裁：最后一个节次行的底边 vs 容器可视底边；
- 判定：`ok` / `needs-no-scroll` / `layout-anchor` / `scroll-disabled` / `touch-layer`。

三种状态的期望判定（本地实测）：正常 → `ok`；锚点失效 → `layout-anchor`；内容不超出容器 → `needs-no-scroll`。

## 5. spec 影响

- `quality-guidelines.md`：在既有「## 构建环境」旁新增一节
  **「构建产物的兼容性契约（视口高度锚点）」**，写清：
  - `html/body` 的高度必须同时提供 `height:100%` 兜底与 `@supports (height:100dvh)` 升级；
    **禁止**把两次 `height` 写在同一规则里（构建器会删前一条）。
  - 当前 CSS/JS 目标基线 = **Chrome 111+ / Safari 16.4+**（Tailwind v4 的默认面）。
  - 「无兜底特性清单」表：`dvh`/`svh`（108 / 15.4）、`oklch`、`color-mix`（111）、容器查询单位
    `cqw/cqh`（105/111）—— 逐条标注「是否已知会降级 / 是否已在范围外」。
- `mobile-schedule-layout.md`：在 Test Hooks / 契约区补一条交叉引用（课表可滚动性依赖视口高度锚点），
  并把 `cdp-dvh-equivalent.mjs` 记进「可复用验收脚本」。
- `quality-guidelines.md` 的同一节再补：**外壳锚点不得单点依赖 `html/body`**（`@supports not (height: 100dvh)`
  里的 `100vh`）、为什么不能同规则双写、以及产物守卫也覆盖这一条；并指向设备诊断器械。
- `mobile-schedule-layout.md` 的器械清单补 `research/device-diagnostics.mjs`（设备侧一键判定落在哪一层）。

## 6. 风险与残余风险

| 风险 | 缓解 |
| --- | --- |
| Tailwind / lightningcss 升级后再次改变「冗余声明」策略，兜底又被删 | AC-4 两条检查（单测直接编译这段 CSS + 产物断言）；任一红即挡在 CI 前 |
| `@supports` 本身在极古内核不被支持 | 项目基线是 Chrome 111+；Android 12 的 WebView 远高于 `@supports` 的起点（Chrome 28）。真要支持更古内核时，改用「拆选择器 + 属性钩子」方案（矩阵里的 E 变体） |
| 只修了 height，Chromium < 111 上 `oklch`/`color-mix`/容器查询单位仍会降级 | 明确出本次范围，但写进 spec 的「无兜底特性清单」，避免再次当成「未知问题」排查 |
| 报告设备修完后仍滑不动（说明另有第二原因） | 按 PRD 的「回到实测」清单重新定位；本次交付不掩盖该可能 |
| 双写高度改变了支持 `dvh` 引擎的行为 | `@supports` 内只有一条声明且在层叠上后写覆盖；AC-5 基线比对覆盖 |
| 不支持 `dvh` 的**老移动浏览器**（非 App）里，C2 的 `100vh` 是「大视口」高度，地址栏展开时外壳可能略高于可见区（底栏被挤到折叠线以下） | 只影响「老浏览器 + PWA」这一组合（App/WebView 里 `100vh` 与可视区一致）；接受该代价换取「外壳锚点不单点依赖」 |

## 7. 回滚

- 改动面：`app/app.css`（一条声明 + 一个 `@supports` 块）、一条可执行检查（新增脚本/单测）、spec 一节。
- 无数据、无迁移、无对外契约。`git revert` 单个提交即回到现状；回滚后 AC-2/AC-3 会重新变红（这是预期的信号）。
