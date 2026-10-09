# 执行计划：恢复 `html, body` 的高度锚点

> 需求见 `prd.md`，方案见 `design.md`，证据与基线数字见 `research/dvh-fallback-evidence.md`。
> **inline 平台（本项目已固化）**：不生成 `implement.jsonl` / `check.jsonl`，主会话直接读 spec 与 `research/`。

## 0. 前置（已完成，不必重跑）

- 现状基线已采：`research/dvh-fallback-evidence.md` §5（412×915 与 1440×900）。
- 等价条件器械已在**修复前**跑通并复现缺陷：`research/cdp-dvh-equivalent.mjs` →
  `html/body` 963px、`clientHeight` 780、`maxScrollTop` **0**、拖动后 `scrollTop` **0**。

## 1. 改动清单（按序执行）

### 1.1 `app/app.css`：改成 `height:100%` + `@supports (height:100dvh)` 升级（design §2）

- 只动 `html, body` 规则：保留 `@apply` 与 `prefers-color-scheme` 的 `color-scheme` 块；`overflow: hidden` 不动；
  新增顶层 `@supports (height: 100dvh) { html, body { height: 100dvh } }`。
- **验证**：`pnpm format:check`（`**/*.css` 在 prettier 覆盖面内）；`pnpm build` 后确认产物里
  `html,body{…height:100%…}` 与 `@supports (height:100dvh)` 同时存在。

### 1.2 AC-4(a)：新增源文件契约单测 `app/appCssViewportAnchor.test.ts`

- 读 `app/app.css`，断言 `html, body` 规则体只有一条 `height` 且为 `100%`；存在 `@supports (height: 100dvh)`
  且块内 `height: 100dvh`。
- **验证**：`pnpm test`（vitest `include: app/**/*.test.ts` 必然收录；CI 已跑 `pnpm test`，无需改 workflow）。

### 1.3 AC-4(b)：新增产物断言 `scripts/check-webview-css-fallback.js`（+ `node --test` 用例）

- 读 `build/client/assets/*.css`，断言兜底与 `@supports` 升级都在；产物缺失时**明确失败**并提示先跑 `pnpm build`。
- `package.json` 增 `webview:check-css`（跑脚本）与 `test:webview-css`（`node --test`），
  并把 `pnpm webview:check-css` 挂到 `cap:build:android` 链尾（与 `android:check-assets` 相邻）；
  `.github/workflows/ci.yml` 在 `pnpm build` 之后加一步（1 行）。
- **验证**：`pnpm build && pnpm webview:check-css && pnpm test:webview-css`；
  临时删掉产物文件应看到「先跑 pnpm build」的失败信息（人工确认一次即可）。

### 1.4 spec 更新（AC-4 的文字侧）

- `quality-guidelines.md`：新增一节「构建产物的兼容性契约（视口高度锚点）」——写法要求、
  **目标基线 = Chrome 111+ / Safari 16.4+**、「无兜底特性清单」表（`dvh`/`svh`、`oklch`、`color-mix`、
  `cqw/cqh`），并写明「禁止把两次 `height` 写在同一规则里」的原因（构建器会删前一条）。
- `mobile-schedule-layout.md`：Test Hooks / 契约区加交叉引用（课表可滚动性依赖视口高度锚点），
  并把 `research/cdp-dvh-equivalent.mjs` 记入可复用验收脚本清单。
- `index.md`：仅在 Status/Description 需要时改动。
- **验证**：人工通读 + `pnpm format:check`。

### 1.5 C2：应用外壳自带视口锚点（design §2b，2026-09-29 追加）

- `app/app.css` 的 `@layer utilities` 内在 `.app-viewport` 之后新增
  `@supports not (height: 100dvh) { .app-viewport { height: 100vh; max-height: 100vh } }`；
  **不要**写进 `.app-viewport` 自身规则（同规则双写会被 lightningcss 当冗余删掉）。
- `app/appCssViewportAnchor.test.ts` 增加源码断言：该 `@supports not` 块存在、覆盖 `.app-viewport`、且写在
  `.app-viewport` 基础规则之后。
- `scripts/check-webview-css-fallback.js` 增加产物断言：产物里存在 `@supports not (height: 100dvh)` 且其中给
  `.app-viewport` 设了 `100vh`；配套单测补正反例。
- **验证**：`pnpm build && pnpm webview:check-css && pnpm test:webview-css`。

### 1.6 D：设备端一键诊断器械（design §4 AC-8）

- 新增 `research/device-diagnostics.mjs`：`node <此文件> <cdp-ws-url>` 连接并输出判定；
  `--print-snippet` 打印同样的自包含表达式（便于贴进 WebView devtools）。
- **验证**：本地三种状态各跑一次（正常 / 锚点被拿掉 / 内容不超出容器），判定分别为
  `ok` / `layout-anchor` / `needs-no-scroll`。

### 1.7 spec 与验收记录

- `quality-guidelines.md`：补「外壳锚点不得单点依赖 `html/body`」、`@supports not` 写法与原因、
  产物守卫的覆盖范围、以及诊断器械指引。
- `mobile-schedule-layout.md`：器械清单补 `device-diagnostics.mjs`。
- `verification.md`：补 AC-7 / AC-8 结论、加固后的基线复核、以及「老移动浏览器 `100vh`」残余风险。

## 2. 质量门与验收（Phase 2.2）

| # | 项目 | 命令 / 器械 | 期望 |
| --- | --- | --- | --- |
| 2.1 | AC-2 / AC-3 | dev + `--init-script` 灌种子 + 412×915 + `research/cdp-dvh-equivalent.mjs` | 等价旧引擎下 `body.scrollHeight <= innerHeight`、`maxScrollTop ≈ 48`、拖动后 `scrollTop === maxScrollTop`、第 12 节底边 ≤ `innerHeight`；正常引擎侧与修复前逐项一致 |
| 2.2 | AC-5 | `research/layout-probe.js` @412×915 与 1440×900 | 逐项对齐 `research/dvh-fallback-evidence.md` §5 |
| 2.3 | AC-1 / AC-4 | `pnpm webview:check-css`、`pnpm test:webview-css`、`pnpm test` | 全绿；且**先用 `git stash` 或临时改回旧写法确认这些检查会红**（证明它们真的能挡住回归） |
| 2.4 | 仓库五项门禁 | `pnpm typecheck` / `lint` / `format:check` / `test` / `build` | 全绿 |
| 2.5 | 证据落盘 | 写 `verification.md` | 逐条 AC 结论 + **未验证项显式标注**（AC-6 真机） |
| 2.6 | AC-7 | `research/preventive-hardening-probe.mjs` @412×915 与 1440×900 + `pnpm webview:check-css` | 场景 2 与基线逐项相同；场景 5 `maxScrollTop > 0` 且拖动后到 `maxScrollTop`；产物含 `@supports not (height: 100dvh)` |
| 2.7 | AC-8 | `research/device-diagnostics.mjs` 在三种状态下各跑一次 | 判定分别为 `ok` / `layout-anchor` / `needs-no-scroll` |

- 2.2 的「自查」用 `trellis-check` 技能按 AC 逐条核验（inline，不派子代理）。
- 门禁失败时按需修，**不允许**把失败项写成「已知问题」蒙过去。

## 3. 真机验收（AC-6，由用户在设备上做）

- 出包 → 装到报告问题的 Android 12 设备 → 课表能否上下滑。
- 若仍滑不动：按 `prd.md`「待确认」小节的清单回报
  （UA 里的 `Chrome/xxx`、`getComputedStyle(html/body).height`、`body.scrollHeight`、
  `[data-schedule-scroll]` 的 `clientHeight/scrollHeight`、纵向拖动时 `scrollTop`），本次交付不掩盖该可能。
- 本沙盒无 `/dev/kvm`、`~/.android` 只读，无法用模拟器，这一条**只能**由用户做；
  若交付时仍缺，在 `verification.md` 显式标为未验证，并按上次的做法另开一个验收任务。

## 4. 提交与收尾（Phase 3.3 / 3.4）

- spec 更新归在同一个任务提交里（3.3）。
- 提交信息：主题用**中文**（`commitlint` 有内联规则，主题必须中文），例如
  `fix(schedule): html/body 高度补回 height:100% 兜底，旧 WebView 上课表可上下滑`。
- 归档任务时补分支/PR 号（沿用仓库既有习惯）。

## 5. 回滚点

- 改动面 = `app/app.css` + 1 个单测 + 1 个脚本(+用例) + `package.json`/`ci.yml` 各 1 行 + spec 两处。
- 无数据、无迁移、无对外契约；`git revert` 单提交即回到现状。
- 回滚后 AC-2/AC-3 会重新变红（= 预期的回归信号，不是额外故障）。

## 6. 明确不做（避免范围蔓延）

- 不动 `.h-svh` / `.min-h-svh`、三处 `[calc(100dvh-2rem)]` 对话框。
- 不下调 lightningcss / Tailwind 的浏览器目标，不加 `browserslist`。
- 不改课表组件、手势 hook、样式类名。
