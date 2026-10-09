# Quality Guidelines

> 类型检查、构建、lint、格式与单元测试都是可信门禁，且由 CI 在 PR 与 master push 上强制。

---

## Overview

工具链是 ESLint 10 flat config（typescript-eslint recommended、react、react-hooks、react-refresh、prettier recommended）和 Prettier。格式配置为 `semi: false`、`singleQuote: true`、`printWidth: 140`、`tabWidth: 2`、`trailingComma: es5`。

可信门禁共五项，全部实测通过：`pnpm typecheck`（`react-router typegen && tsc`）、`pnpm build`（`react-router build`）、`pnpm lint`（`eslint . --report-unused-disable-directives --max-warnings 0`）、`pnpm format:check`、`pnpm test`（vitest）。`.github/workflows/ci.yml` 在 PR 与 master push 上运行同一组命令，外加一道 `pnpm test:android-assets`（资产守卫的纯函数单测；vitest 的 `include` 只收 `app/**/*.test.ts`，所以它必须单独跑）。

`pnpm lint` 当前为 **0 problems**。`eslint.config.js` 的 `ignores` 与 `.prettierignore` 都排除了 `.pi/`、`.agents/`、`.claude/`、`.codebuddy/`、`.codex/`、`.trellis/`（这些目录**已被 git 跟踪**，所以 `.gitignore` 管不到，必须写进各自工具的 ignore 文件；否则会扫出 `.pi/extensions/trellis/index.ts` 的千余条生成物告警）。

根目录那几个由执行环境 bind mount 的 `/dev/null` 设备文件（`.bashrc`、`.mcp.json` 等）**只在 `.gitignore` 里列了一次**，没有重复写进 `.prettierignore`。原因是 prettier 的 `--ignore-path` 默认值就是 `[.gitignore, .prettierignore]`——`.gitignore` 本来就会被读取。实测：两处都没有时 `format:check` 会因 `.mcp.json` 的 `EACCES` 以退出码 2 失败，只保留 `.gitignore` 一处则为退出码 0。

---

## Forbidden Patterns

不要提交与现有 TypeScript 规则冲突的代码：普通位置不要 `any`，不要使用 `@ts-ignore`/`@ts-expect-error`/`eslint-disable`，不要写 effect 内同步 setState、渲染期调整 state 或渲染期访问 ref。这三类写法曾出现在 `app/hooks/use-mobile.ts`、`app/components/stepper/useStepper.ts`、`app/components/stepper/Stepper.tsx`，已于 2026-09 全部清除，替代写法见 `hook-guidelines.md`；不要改回去。

不要为 agent 配置目录（`.pi/`、`.agents/`、`.claude/`、`.codebuddy/`、`.codex/`）新增 lint 规则或放宽现有规则 —— 它们已由 `eslint.config.js` 的 `ignores` 排除，规则只应对 `app/` 等源码生效。也不要把刻意注入教务页面的 `app/lib/bookmarklets/*/script.ts` 中的 console 调用误判为普通调试代码。

目前唯一的规则级例外是 `app/components/ui/**` 关闭了 `react-refresh/only-export-components`：这是 shadcn 同文件导出组件与常量/hook 的固有形态，拆文件会在 `shadcn add` 重新生成时被覆盖。该目录的其余规则（含 `react-hooks` 全套）仍然生效，因此不要往这个覆盖块里继续加规则。

---

## Required Patterns

代码保持无分号、单引号和 140 列；复杂算法、日期、迁移逻辑用中文 JSDoc（包含 `@param`、`@returns`），简单展示组件通常不写注释。UI 文案使用中文，根文档语言为 `zh-CN`。

交互反馈统一使用 `sonner`：

```ts
import { toast } from 'sonner'

toast.success('数据导入成功')
```

条件 Tailwind 类名通过 `cn()`：

```tsx
<div
  key={day}
  className={cn(
    'flex items-center justify-center border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground sm:text-sm',
    day !== 7 && 'border-r'
  )}
>
  <span>{dayNames[day]}</span>
  {date && <span className="ml-1.5 text-[10px] font-normal sm:text-xs">{format(date, 'MM.dd')}</span>}
</div>
```

上述写法分别与项目的 toast 调用和 `app/features/schedule/ScheduleTable.tsx` 的 Tailwind/cn 风格一致；图标使用 `lucide-react`，响应式采用移动优先断点。

---

## Testing Requirements

测试使用 vitest：`pnpm test`（= `vitest run`）与 `pnpm test:watch`，配置在独立的 `vitest.config.ts`（刻意不复用 `vite.config.ts`，以免加载 reactRouter、tailwind、PWA 插件），`environment: 'node'`，`include: ['app/**/*.test.ts']`。测试文件与被测模块**同目录**（co-located），只覆盖纯逻辑，不覆盖组件与 hook。

**注意**：`include` 只匹配 `*.test.ts`。以后若要加 `.test.tsx` 组件测试，必须同步扩展该配置，否则测试会被静默跳过并让门禁产生虚假安全感。

已覆盖的四个纯逻辑模块是 `app/store/migrations.ts`、`app/lib/parsers/*`、`app/store/utils.ts`、`app/features/dashboard/utils.ts`（4 个文件 16 个用例）。它们最容易回归：包含时区敏感的日期推算、schema 迁移和学校 payload 解析，因此改动这些模块时必须同步补测试。

涉及日期的测试必须**显式传入** `importedAt` 与日期字符串，不得依赖 `new Date()` 的当前时刻，否则会在 CI（UTC）与本地（UTC+8）得出不同结果。

---

## Code Review Checklist

- 是否只改了任务范围内的目录，路由是否仍只是 re-export 壳？
- 是否遵循 `import type`、非导出 `type XxxProps`、Tailwind 原子类和 `cn()`？
- 是否检查 Zustand 的扁平投影与 `semesters` 同步、持久化 `partialize` 和 schema 迁移？
- 是否运行 `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`？五项当前全绿，其中任何一项失败都属于本次改动引入的问题，不得用抑制手段绕过。
- 是否对测试未覆盖的区域（组件、hook、页面）说明了手工验证方式或残余风险，而不是把「类型检查通过」当成行为验证？
- 是否保留中文 UI 文案和中文复杂逻辑注释，避免无关的格式或技术债重构？

---

## 提交信息（Commit Message）

**主题必须用中文写**，由 `commitlint.config.cjs` 里的内联插件规则强制，不靠自觉：

| 位置 | 规则 | 级别 |
|---|---|---|
| 主题 | 必须含中文（否则拒绝提交） | error（`subject-chinese`） |
| 正文 | 非空时应含中文 | warning（`body-chinese`，`Refs: #12` 这类英文脚注不拦） |
| `type` | 仍限定在 `build \| chore \| ci \| docs \| feat \| fix \| perf \| refactor \| revert \| style \| test` | error（`type-enum`） |
| `scope` | 保持英文标识（`widget`、`android`、`import`…），便于工具与检索 | 约定 |

```text
fix(widget): 修掉点卡片打不开 App 的问题      ✅
ci(android): 自动发布测试版 APK                ✅
fix(widget): keep card clicks working          ❌ 主题没有中文
```

- 本地：husky 的 `.husky/commit-msg` → `pnpm commitlint --edit`，`git commit` 时即被拦下；
- CI：`.github/workflows/ci.yml` 的 `commitlint` job 校验 PR 范围内的每个提交，因此 `--no-verify` 绕不过去；
- 手工自查：`pnpm exec commitlint --edit <文件>`，或对一段范围 `pnpm exec commitlint --from <A> --to <B> --verbose`；
- **不回改历史**：2026-09-20 之前的提交信息是英文的，规则从该日起对新提交生效。
- **Trellis 脚本的自动提交也算数**：`task.py archive` 与 `add_session.py` 会各自产生一次自动提交（`chore(task): 归档 <slug>`、`chore(trellis): 记录会话日志`），它们同样过 husky 钩子。上游默认主题是英文，本项目已改成中文：会话日志主题在 `.trellis/config.yaml` 的 `session_commit_message`，归档主题在 `.trellis/scripts/common/task_store.py`（该文件是上游模板，`trellis update` 可能覆盖回英文）。这两处一旦被改回英文，`task.py archive` 会以「归档已落盘、自动提交失败」的中间态结束 —— 此时用中文主题手工提交即可，不要用 `--no-verify`。

## 构建环境

五项门禁在本机直接执行即可（Node 22 + pnpm 9.15.9 是当前对齐版本）。

Android 构建（`pnpm cap:build:android` 产出 debug APK）需要本机一次性补齐：JDK 21（含 `jlink`）、Android SDK（`platforms;android-36` + `build-tools;36.0.0` + `platform-tools`）、以及写入 `sdk.dir` 的 `android/local.properties`（gitignore 的机器本地文件）。步骤与排坑见 README「本机 Android 构建环境」段；`scripts/install-android.sh` 同时支持 Linux 与 macOS。

Android Studio 直接启动时，必须打开仓库内的 `android/` 目录，而不是仓库根目录；后者是 Web 工程。Gradle JDK 选择 Android Studio bundled JDK 21 或本机完整 JDK 21，完成同步后选择 `app` 运行配置。不要提交 `.idea`、`android/local.properties`、`android/gradle/gradle-daemon-jvm.properties` 或 Foojay toolchain resolver 配置：这些属于本机 IDE/缓存环境，可能让同步依赖机器路径或额外网络下载。

网络不畅时有两个入库的逃生通道：gradle 发行版可从华为云预置到 wrapper dists 目录；依赖镜像可复制 `scripts/gradle-mirrors.init.gradle` 到 `~/.gradle/init.d/`（华为云中央仓库优先、阿里云 Google Maven 其次、官方仓库兜底）。注意华为云**没有**可用的 Google Maven 镜像（实测返回 HTML）。

Android 发布由 `.github/workflows/android-release.yml` 自动完成，两条轨道同一个 job，用工作流级 `IS_STABLE`（`startsWith(github.ref, 'refs/tags/v')`）分流 —— 注意 `env` 上下文在 job 级 `if` 里不可用，只能写在 step 级 `if`：

- **测试版**：merge 进 `master` 且改动可能影响 APK 时触发（`app/**`、`public/**`、`android/**`、`scripts/**`、`.github/**`，加上决定产物内容/打包方式的根配置；纯文档改动不发版），也可手动 dispatch。产物挂到 `android-beta-<序号>` 预发布上（序号 = 已有测试版标签的最大值 +1）。**历史测试版一律保留、不再清理**（2026-09-23 起；原先的「只保留最近 10 个」已随更新提示的落地取消 —— 测试者用 `ClassTrack-beta-latest.apk`，应用内也会提示新版本）。
- **正式版**：**只能手动触发** —— `workflow_dispatch` 时 `release_kind=stable` 并填写版本号；tag push 不再触发任何发布，`v<版本号>` 由发布步骤自己创建。发布前校验本次运行的提交在 `master` 上、版本号形如 `X.Y.Z`、`tag v<版本号>` 尚不存在，任一不满足即失败。

两条轨道都跑 `pnpm cap:sync:android`、原生单元测试、`assembleRelease`、并用 `CLASS_TRACK_ANDROID_APK_PATH` 指向**本次要发布的那个包**做资产一致性校验。**两条轨道都必须发签名包**：缺签名 Secrets 时工作流直接失败，不回退 debug 包 —— debug 与 release 签名不同，测试机无法原地升级、只能卸载重装并丢数据（2026-09-20 用户实测反馈）。签名凭据只从 Secrets 读（`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`），`android/app/build.gradle` 只在四个环境变量齐备时注册 `signingConfigs.release`，因此编译步骤会先断言这四个环境变量非空。生成与上传方式见 README「发布与签名」段。**不要**把签名密钥或 `android/local.properties` 提交进仓库。

versionName 按轨道取值（测试版 `1.0.<序号>-beta`，正式版取 tag 去掉 `v`）；versionCode 两条轨道统一取构建时刻的 epoch 秒，它跨轨道、跨 workflow 重命名都单调递增，测试机才能一路覆盖安装（beta → 正式版 → beta）。

**不要用 `run_number` 当版本号或标签**：它是「每个 workflow 各自计数」的。2026-09-20 把 `android-beta.yml` 改名为 `android-release.yml` 后，新 workflow 的 `run_number` 从 1 重新开始，于是 `android-beta-1` 与既有 release 撞名、发布步骤以 `a release with the same tag name already exists` 失败；即使绕开撞名，重命名后的小序号也会小于测试机已装的版本，覆盖安装会被系统拒绝。

生产镜像是两阶段构建（Node 22 + pnpm 构建 → nginx 托管 `build/client`，监听 3000）：`docker build -t classtrack .` 与 `docker run --rm -p 3000:3000 classtrack`。SPA 深层路由回退 `index.html`，`sw.js`/manifest/`index.html` 均为 `no-cache`，哈希资产长缓存。`pnpm start` 是 SSR 模式的模板残留脚本，本项目 `ssr: false` 下必然失败，不要使用。

## 构建产物的兼容性契约（视口高度锚点）

> 来源：任务 `09-29-fix-schedule-scroll-legacy-webview`（Android 12 上课表完全无法上下滑动）。

### 当前支持基线

CSS/JS 目标基线 = **Chrome 111+ / Safari 16.4+**（Tailwind v4 的默认面）。超过这条线的引擎**不保证**可用，
但**必须保证不会静默失效**：低于基线的引擎要能落到可用的降级上，而不是「页面看着正常、功能悄悄没了」。
这条线的依据是构建器行为：lightningcss 认为目标支持某特性时，会把「被它覆盖的前一条声明」当冗余删掉。

### 「没有兜底」的特性清单

| 特性 | 支持起点 | 现状 |
| --- | --- | --- |
| `dvh` / `svh` / `lvh` | Chrome 108 / Safari 15.4 | ⚠️ **已修**：`html/body` 高度靠独立 `@supports (height: 100dvh)` 块升级，兜底 `height: 100%` 写在块外；**应用外壳另有 `@supports not (height: 100dvh)` 的第二条锚点**（见下） |
| `oklch()` / `color-mix()` | Chrome 111 / Safari 16.4 | 未兜底，出范围；低于基线的引擎会丢颜色，不丢功能 |
| 容器查询 / `cqw` / `cqh` | Chrome 105（单位 105，`@container` 105） | 未兜底，出范围；低于基线的引擎课程格字号会退化为默认值 |
| `.h-svh` / `.min-h-svh` | Chrome 108 | ⚠️ **仍未兜底**（sidebar 包装用），已知但未修 |
| `[calc(100dvh-2rem)]` 对话框 | Chrome 108 | ⚠️ **仍未兜底**（`ImportDialog` / `MarkdownEditorDialog` / `ScheduleCourseDialog`），已知但未修 |

### 视口高度锚点：写法契约（**必须遵守**）

应用外壳的高度链是 `html`, `body` → `.app-viewport` → `SidebarInset` → 页面根 → 滚动容器。
链条上只有 `html/body` 是「确定高度」的真源，**它一旦失效，全站所有内部滚动区都会退化成内容高度**
（`scrollHeight == clientHeight`，于是「内容被 `overflow: hidden` 裁掉且永远滚不到」）。

```css
/* ✅ 正确：兜底写在块外，dvh 用独立 @supports 块升级 */
html,
body {
  height: 100%;
  overflow: hidden;
}

@supports (height: 100dvh) {
  html,
  body {
    height: 100dvh;
  }
}
```

**禁止**写成同一规则里的两次 `height` 声明：

```css
/* ❌ 构建产物里只剩 height:100dvh —— lightningcss 把前一条当「被后一条覆盖的冗余声明」删掉了 */
html,
body {
  height: 100%;
  height: 100dvh;
}
```

其他已知不可行的写法（都已实测，见任务 `research/lightningcss-fallback-matrix.mjs`）：

- `height: 100vh` + `height: 100dvh`：`100vh` 同样会被删；
- `height: 100dvh` + `height: 100%`（顺序颠倒）：`dvh` 被删，现代引擎也退回 `100%`；
- `html{height:100%}` + `body{height:100dvh}`：两条都在，但两个元素高度来源不一致，语义变了；
- `min-height: 100%`：父级是 `auto` 时等于 `auto`，不解决问题。

### 外壳锚点：不得单点依赖 `html/body`

`html/body` 是高度链的**唯一**真源，它失效时全站内部滚动区一起失效。因此应用外壳自己再拿一条只在
「不支持 `dvh` 的引擎」上生效的锚点：

```css
@layer utilities {
  .app-viewport {
    height: 100%;
    max-height: 100%;
  }

  /* 只在不支持 dvh 的引擎上生效：那里 100vh 就等于 WebView 高度 */
  @supports not (height: 100dvh) {
    .app-viewport {
      height: 100vh;
      max-height: 100vh;
    }
  }
}
```

- **必须**用独立的 `@supports not` 块：写进 `.app-viewport` 自身规则会被 lightningcss 当「被覆盖的冗余声明」删掉
  （与 `html/body` 那条同一机制）。实测它**不会**把「对目标恒假」的 `@supports not` 块优化掉，产物里能查到。
- 对支持 `dvh` 的引擎恒不生效 → 零影响（412×915 / 1440×900 基线逐项不变）。
- 救援能力实测：把 `html/body` 的 `height` 全部拿掉（= 修复前状态）时，加上这条锚点后 `maxScrollTop` 0 → 48、
  纵向拖动 0 → 48，课程格 49×121 → 47×121、字号 10.5474px → 10.1108px 全部回到基线。
- 已接受的代价：不支持 `dvh` 的**老移动浏览器**（非 App）里 `100vh` 是「大视口」高度，地址栏展开时外壳可能略高于
  可见区；App/WebView 里 `100vh` 与可视区一致。

### 防回归检查（两条，都必须存在）

- `app/appCssViewportAnchor.test.ts`（vitest，随 `pnpm test` 与 CI 一起跑）：**源码结构**断言 ——
  `html, body` 规则体只有一条 `height` 且为 `100%`、存在 `@supports (height: 100dvh)` 块且覆盖 `html, body`、
  升级块写在兜底之后。
  以及**外壳锚点**：`.app-viewport` 的基础规则之后存在 `@supports not (height: 100dvh)` 块且其中 `height` 为 `100vh`。
- `scripts/check-webview-css-fallback.js`（`pnpm webview:check-css`，需先 `pnpm build`）：**真产物**断言 ——
  兜底在升级块之外、`dvh` 升级块存在、兜底在升级块之前。挂在 `cap:build:android` 链尾与 CI 的 `pnpm build` 之后。
  外加**外壳锚点**：`@supports not (height: 100dvh)` 块仍在产物里，且其中给 `.app-viewport` 设了 `100vh`
  （构建器若把整块优化掉，就等于悄悄卸掉了双保险）。

改动 `html/body` 的高度、或升级 Tailwind / Vite / lightningcss 之后，这两条必须仍然为绿；
只改源码没改对会表现为「页面正常但课表滑不动」，没有任何运行时报错，所以**不要**只靠人眼看。

### 设备侧诊断：`device-diagnostics.mjs`

`.trellis/tasks/09-29-fix-schedule-scroll-legacy-webview/research/device-diagnostics.mjs`（不改产品代码）：

```bash
node research/device-diagnostics.mjs --print-snippet            # 打印自包含表达式，贴进 WebView devtools
node research/device-diagnostics.mjs <cdp-ws-url>               # 连上去跑
node research/device-diagnostics.mjs <cdp-ws-url> --touch-failed  # 手指实测滑不动时带上
```

它输出 UA 里的 `Chrome/xxx`、高度锚点链（`html` / `body` / `.app-viewport` / `innerHeight`）、滚动量、
祖先链逐层的 `touch-action` / `overflow-y` / 内联 `transform`，并做**程序化滚动对照**，最后给出判定：
`ok` / `needs-no-scroll` / `layout-anchor`（锚点或布局层）/ `scroll-disabled` / `touch-layer`（触摸事件层）。
「手指滑不动」无法在页面内自动检测（合成的 `TouchEvent` 不驱动原生滚动），所以报 `touch-layer` 需要显式加
`--touch-failed`。遇到「滑不动」先用它定位到层，再决定改哪里。
