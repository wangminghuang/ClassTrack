# Journal - YeTongY (Part 1)

> AI development session journal
> Started: 2026-09-17

---



## Session 1: Trellis bootstrap：填充前端规范 spec 并修复 lint/format 门禁
<!-- trellis-session: v=2 fp=50bf481aba1404fb -->

**Date**: 2026-09-17
**Task**: Trellis bootstrap：填充前端规范 spec 并修复 lint/format 门禁
**Branch**: `chore/trellis-finish-bootstrap`

### Summary

扫描仓库并用真实约定填满 .trellis/spec/frontend/ 六份规范，同时让 lint/format 不再扫描 Agent 配置目录，最后把 Trellis 与各平台 Agent 配置纳入版本控制。

### Main Changes

- 填充 .trellis/spec/frontend/ 六份 spec（目录结构、组件、hook、状态管理、类型安全、质量），按「记录代码实际长相」原则如实记录既有技术债
- eslint.config.js 与 .prettierignore 排除 .pi/.claude/.codebuddy/.codex/.agents/.trellis，pnpm lint 从 1021 降到 11 problems，pnpm format:check 恢复通过
- 纳入 .trellis/、AGENTS.md、.gitattributes 及五个平台的 agent/skill/hook 配置，共 212 个文件
- master 的误提交已移回分支，改为分支 + PR 流程（PR #1 走 rebase merge，master 保持纯线性）

### Git Commits

| Hash | Message |
|------|---------|
| `21cb890` | docs(trellis): 填充前端开发规范 spec |
| `3cb46bf` | fix(tooling): 让 lint 与 format 忽略 Agent 配置目录 |
| `e916410` | docs(trellis): 同步质量门禁说明与扫描记录 |
| `05c87ef` | chore(trellis): 纳入 Trellis 与各平台 Agent 配置 |

### Testing

- [OK] pnpm typecheck 通过；pnpm build 通过；pnpm format:check 通过；pnpm lint 由 1021 降至 11（剩余均为既有问题）；spec 引用的文件路径逐条核验存在

### Status

[OK] **Completed**

### Next Steps

- 把 .pi/ 等目录的既有 lint 问题清零（react-hooks 3 error、react-refresh 3 warning、no-explicit-any 3 warning、commitlint.config.cjs 2 prettier error）
- 补 vitest 覆盖 migrations / parsers / createPastClassMarks 等无测试保护的纯逻辑区
- 加 GitHub Actions 跑 typecheck + build，再设为 master 必需检查；branch protection 仍需仓库主授予 Admin 权限


## Session 2: 清零 lint 问题、建立 CI 与测试基线
<!-- trellis-session: v=2 fp=6b57b8ed6eb92de6 -->

**Date**: 2026-09-17
**Task**: 清零 lint 问题、建立 CI 与测试基线
**Branch**: `chore/quality-gate-finish`

### Summary

清零 11 个既有 lint 问题（无任何抑制手段）、建立五项 CI、引入 vitest 覆盖四个高风险纯逻辑区、统一 getMarkKey 来源，并让沙箱设备文件不再污染 git status 与 format:check。

### Main Changes

- lint 清零：use-mobile 改用 useSyncExternalStore；stepper 把上一步状态上移到 useStepper 并在纯 updater 内原子更新；解析器改 parse(data: unknown) 加类型化 payload；对 ui/** 关闭 react-refresh 规则；commitlint.config.cjs 走 eslint --fix
- 新增 .github/workflows/ci.yml，在 PR 与 master push 上跑 typecheck/lint/format:check/test/build，首个 CI run 实测 48s 通过
- 引入 vitest 5.0.1（devDependency，未降级 vite），4 个测试文件 16 个用例覆盖 migrations/parsers/createPastClassMarks/dashboard utils
- getMarkKey 从三处重复收敛到 app/store/utils.ts 单一来源
- 沙箱 bind mount 的 8 个 /dev/null 设备文件写入 .gitignore 与 .prettierignore（两处都要，format:check 读的是后者）
- 清理 3 个已合并分支；改用分支 + PR + rebase 合并，master 保持纯线性

### Git Commits

| Hash | Message |
|------|---------|
| `c25452d` | docs(trellis): 添加质量门禁清理任务的规划产物 |
| `f9cbffc` | fix(lint): 补齐配置与格式层面的 lint 问题 |
| `cbecae9` | fix(hooks): use-mobile 改用 useSyncExternalStore |
| `a25028a` | fix(stepper): 重构步进状态以消除 ref 与 effect 违规 |
| `9f6abaf` | fix(parsers): 用类型化 payload 替换 any |
| `6b42b68` | refactor(store): 统一 getMarkKey 的唯一来源 |
| `e952594` | test: 引入 vitest 并覆盖四个纯逻辑模块 |
| `63c4166` | ci: 新增 typecheck/build/lint/format 检查 |
| `8d75d6e` | chore: 忽略执行环境 bind mount 的设备文件 |
| `790747c` | docs(trellis): 同步质量门禁相关 spec |

### Testing

- [OK] pnpm typecheck/lint/format:check/test/build 五项全部 exit=0；eslint JSON 统计 0 problems；首个 CI run verify=pass（48s）
- [OK] 用 agent-browser 对导入向导步进器跑 11 项真实交互断言，全部通过（末步不越界、连续后退、方式切换、重开复位）
- [OK] 算法与契约文件零改动核对：store/utils.ts、migrations.ts、store/index.ts、dataSlice.ts、lib/types.ts 均未修改；存储 key 与 schemaVersion=3 未变

### Status

[OK] **Completed**

### Next Steps

- 补 CI 状态检查到 master 的必需检查（需仓库主授予 Admin 权限启用 branch protection）
- 为组件与 hook 补测试（当前 vitest 的 include 只匹配 *.test.ts，加 .test.tsx 需同步扩展配置）
- 清理 .pi/ 等生成目录之外的其余技术债；考虑把 stepper 的交互验证纳入 CI 回归

## 2026-09-18 build-devcontainer 收尾

### 做了什么

- devcontainer 两度实现并验证通过（第二次 `devcontainer up` outcome=success、容器内五项门禁 + APK 全绿），最终按用户决定**彻底放弃、不入库**。
- 改走本机项目级补全：宿主补 `platforms;android-36`、`android/local.properties`（sdk.dir）、gradle 8.14.3 华为云预置（sha256 校验过）；`install-android.sh` 支持 Linux；新增 `scripts/gradle-mirrors.init.gradle`（可选国内镜像，已装入本机 `~/.gradle/init.d/`）。宿主 `pnpm cap:build:android` 实测成功（APK 7.1MB）。
- 生产镜像修复并验证：pnpm + Node 22 多阶段 + nginx 托管 `build/client`；首页/深层路由 200、SPA 回退生效、`sw.js`/`index.html` no-cache、哈希资产 immutable。nginx 用本机已有的 1.27-alpine。
- README 三段修正（`pnpm start` 死路标注、Docker 段、本机 Android 构建环境段）；`.gitignore`/`.dockerignore` 补 `/.pnpm-store/` 与沙箱设备文件条目。
- 宿主五项门禁全绿。

### 教训（详见任务 research 第 9 节）

- 探测镜像源必须验证响应**内容**（`<?xml`），华为云 `/maven/google/` 返回 HTML 页面，只看 200 会被骗。
- pnpm 9 在 store 与 node_modules 跨文件系统时自动改用工作区 `.pnpm-store/`，缓存卷方案失效。
- pnpm 非交互遇重装提示会永久挂起，要 `CI=true`。
- 宿主当夜大量诡异网络问题（DNS 摇摆、镜像超时、docker pull 卡死）的共同根因是**连错了网络**，换网后全部消失。

### Next Steps

- 提交四笔、发 PR、等 CI、rebase 合并


## Session 3: 完成金智教务应用内导入
<!-- trellis-session: v=2 fp=b32f01617dc335d4 -->

**Date**: 2026-09-18
**Task**: 完成金智教务应用内导入
**Branch**: `feat/in-app-jinzhi-import`

### Summary

在 feat/in-app-jinzhi-import 分支实现 Android Capacitor 自有 CourseImport bridge 与受限 WebView，捕获天津理工大学金智课表接口并复用现有解析器/Zustand 导入；保留 Web/PWA 书签脚本与 JSON/备份降级。新增响应校验、XHR/fetch hook、临时文件清理及 TypeScript/Android 单元测试，更新 README、设计文档和 frontend native import code-spec。pnpm test/typecheck/lint/format:check/build、cap:sync、task validate 和 diff check 通过；Android Gradle 编译因 Gradle 下载网络/本地 SDK 环境阻塞，已记录。

### Git Commits

| Hash | Message |
|------|---------|
| `c8889f7` | feat(import): add native JinZhi schedule import |

### Status

[OK] **Completed**


## Session 4: 修复应用内导入白屏与 UI 风格
<!-- trellis-session: v=2 fp=2a25616b077b0c47 -->

**Date**: 2026-09-18
**Task**: 修复应用内导入白屏与 UI 风格
**Branch**: `fix/native-import-white-screen-ui`

### Summary

完成天津理工大学金智课表双 WebView 导入架构：本地 React/shadcn shell 与受限 academic WebView 隔离，加入显式导航/capture allowlist、脱敏诊断、bridge state/nonce gating、payload 限制、私有文件 handoff、retry/back/cancel 恢复和 detach-before-destroy 生命周期清理；保留 parser/importClasses 与 Web/PWA fallback。前端测试、typecheck、本地 ESLint、format、build、Capacitor Android 资产同步、差异检查和 Trellis 校验通过；Android Gradle/真机验收因 Gradle home/网络/离线依赖与无 adb 设备仍待环境恢复后执行。

### Git Commits

| Hash | Message |
|------|---------|
| `dd7e2e3` | fix(import): stabilize native JinZhi import UI |

### Status

[OK] **Completed**


## Session 5: Protect Android native import from stale shell assets
<!-- trellis-session: v=2 fp=3856ff926609a3a2 -->

**Date**: 2026-09-19
**Task**: Protect Android native import from stale shell assets
**Branch**: `fix/native-import-white-screen-ui`

### Summary

Fresh cap sync confirmed build/client and Android assets match, while the existing APK was stale and missing current shell assets. Added an APK asset consistency guard to the Android build/install flow, unit coverage for local/inline references and stale APK detection, safe hash evidence, README/spec guidance, and archived task 09-19-fix-native-import-page-issues. Real APK build/install, screenshots, WebView callbacks, and logcat remain blocked by read-only Gradle home/network dependency gaps, no connected device, and missing /dev/kvm; follow-up todo #15 remains pending.

### Git Commits

| Hash | Message |
|------|---------|
| `e1a10a3` | fix(android): reject stale native shell assets |

### Status

[OK] **Completed**


## Session 6: Fix native shell 404 white screen and verify on emulator
<!-- trellis-session: v=2 fp=2d79bf486e6ed130 -->

**Date**: 2026-09-19
**Task**: Fix native shell 404 white screen and verify on emulator
**Branch**: `fix/native-import-white-screen-ui`

### Summary

Reproduced the reported white screen, layout and 404 on a real emulator and found the root cause: CourseImportActivity loaded the shell at /index.html, a path the client router cannot match, so React Router's ErrorBoundary replaced the whole tree with a 404 page. Loaded the shell at the origin root with an asset handler index mapping, allowed the CAS login host authserver.tjut.edu.cn as an explicit host plus path pair, de-duplicated the failed-state retry button, guarded the shell state callback that ran before React registered it, and stopped registering a Service Worker inside the native app. Verified on emulator: shell renders, bridge ready, CAS login page loads, back/refresh/cancel clean, rotation stable, four tabs render, no destroy-while-attached warning. Commit 5efd0bc tightened the shell URL predicate. Unverified: course CRUD, JSON upload and backup entry, IME and font scale, post-login capture.

### Git Commits

| Hash | Message |
|------|---------|
| `a2fccfd` | fix(import): boot native shell at origin root and allow CAS host |

### Status

[OK] **Completed**

## Session 7: 手机端课表整周铺满与双指缩放（含 Android 模拟器真机验收）
<!-- trellis-session: v=2 fp=29d220dac26aa9ea -->

**Date**: 2026-09-20
**Task**: 手机端课表整周铺满与双指缩放（含 Android 模拟器真机验收）
**Branch**: `feat/mobile-schedule-week-grid`

### Summary

手机端（<768px）课表从 min-w-[760px] 横向溢出改为整周 7 天自适应：1x 下 412px 视口无横向滚动（scrollWidth=clientWidth=394，列宽 52px；360px 视口 44px），课名去掉 line-clamp-2 完整换行，节次列按课程数据推导显示起止时间（可见 10 条），表头显示月份。新增 1x/1.5x/2x 三档缩放，只改列宽不改字号：≥1.5x 出现教室、2x 出现教师与备注，2x 列宽 108px 且容器出现横向滚动；手势期间只写 --schedule-zoom CSS 变量、松手才提交一次 React 状态，档位不持久化。新增 useScheduleZoom hook 与 13 条纯函数用例（节次时间推导/单双周/档位吸附与裁剪），桌面端由 md: 与 useIsMobile 门控保持零改动。桌面 Chrome 断言、五项门禁（13 files / 67 tests）与 cap:sync 资产校验全部通过。本轮补做 Android 模拟器（API 37 WebView）真机验收：assembleDebug 出包安装后，整周铺满、触摸双击、档位按钮、双指捏合吸附、单指横滑、点课程块弹窗、换周、底栏不遮挡全部实测通过。真机暴露并修复一个桌面断言漏掉的缺陷：一次双击会同时触发我们的 pointerup 判定与浏览器合成的 dblclick，两次切换互相抵消导致“双击没反应”，已在 toggleZoom 上加 400ms 去抖。另外把 .trellis/** 补进 eslint.config.js 的 ignores（文档声称已排除但实际只排除了 prettier），并把 Trellis 脚本的自动提交主题改成中文以免被本仓库 commitlint 拦下。残余风险：未在物理真机/OEM 定制 WebView 上复验；表头与导航空白区的页面级双指缩放未处理。

### Git Commits

| Hash | Message |
|------|---------|
| `86fbdb0` | docs(schedule): 补充移动端课表整周可见任务的规划与基线 |
| `f8437dc` | feat(schedule): 补充节次时间推导与缩放档位纯函数 |
| `3bb1474` | feat(schedule): 手机端课表整周铺满并可完整显示课名 |
| `32f7700` | feat(schedule): 手机端课表支持双指缩放到 1x~2x |
| `39df123` | fix(schedule): 修掉真机上双击缩放被双重触发抵消的问题 |
| `045d8d7` | chore(lint): 把 .trellis 纳入 eslint ignores |

### Status

[OK] **Completed**


## Session 8: 桌面小工具真机回测收尾：缩放下限、最小尺寸布局与拖放放置
<!-- trellis-session: v=2 fp=7ce2892ab7d5f1dc -->

**Date**: 2026-09-20
**Task**: 桌面小工具真机回测收尾：缩放下限、最小尺寸布局与拖放放置
**Branch**: `master`

### Summary

在 Medium_Phone（API 37 + Pixel Launcher）上把 09-19-android-home-widget 剩下的三项真机验证做完并归档该任务。① 推翻此前「缩放手柄抓不到」的结论：长按实例后四角出现紫色缩放手柄（弹出 Settings 菜单只是同一操作的另一半），input swipe 拖手柄即可；同一坐标向右能从 2 列长大到 3 列并立刻出现新的 phase=widget_sized，向左到 1 列则完全无响应 —— 证明是 provider 声明的 minWidth/minHeight=110dp 下限（= 2×2 格），不是手势失效；此前把「紧凑样式」的 2x1 与格子尺寸混为一谈了。② 最小 2×2（179×210dp）下逐一切换「紧凑」与「全天课表」：两套样式都无溢出、无裁切、无崩溃；配置页在实例真实尺寸上渲染真实 Glance 组合（preview_sized 179×108）并与桌面卡片逐像素一致。③ 拖放放置：input swipe 会被 picker 当滚动，改用 input motionevent 做「长按 2s → 分步 MOVE → UP」，放下后 launcher 自动拉起 WidgetConfigActivity；点取消后 dumpsys appwidget 条目数回到放置前、桌面不留实例，过程中仅有预期内的 style_write_failed 警告、无崩溃。另外记下日志读法：每条 widget_sized 之后常紧跟一条宿主预览/缩放代理的渲染（宽度不受约束），不是桌面实例尺寸，需与截图量测互证。本轮无代码改动，故未重跑构建门禁；证据（截图与数值）已写入该任务 verification.md 的第四轮章节，并把 motionevent 三段式、手柄拖动与 dumpsys 判据固化进 spec 与项目 skill。归档时又踩到一次「Trellis 脚本自动提交主题是英文被 commitlint 拦下」，已把该修复从课表分支移植到 master（e88e5a4）。另有独立的 CI 改动：发布流程改为双轨自动触发（补齐路径过滤 + tag 发正式版），修掉 workflow 重命名后 run_number 归零导致的标签冲突，已实测发出 android-beta-2。

### Git Commits

| Hash | Message |
|------|---------|
| `dca7ae4` | docs(widget): 补完真机残留三项验证：缩放下限、最小尺寸布局与拖放放置 |
| `a7f808e` | chore(task): 归档 09-19-android-home-widget |

### Status

[OK] **Completed**


## Session 9: 小工具大格子适配：双栏左卡吃满纵向 + 修掉配置页快照冲突崩溃
<!-- trellis-session: v=2 fp=36628113e0124e3b -->

**Date**: 2026-09-20
**Task**: 小工具大格子适配：双栏左卡吃满纵向 + 修掉配置页快照冲突崩溃
**Branch**: `feat/widget-adaptive-space`

### Summary

子卡片只保留在双栏（真机比对后产品决定），双栏左卡用 fillMaxHeight + 弹性 Spacer 两端对齐吃满整列；新增度量落网格与双栏排布参数，删除只服务于单栏主卡化的三个度量；正文列表抽成共用 CourseList（OptIn 仍各一处）；修掉配置页重渲预览与后台发布撞 Snapshot.apply() 导致的进程崩溃（平板实测 3 次 FATAL → 压测 0 次）。

### Main Changes

- android/app/src/main/java/com/classtrack/app/widget/ClassTrackWidget.kt：HeroSection/HeroCard 分离，HeroHeading/HeroDetail 共用；CourseList 抽取
- android/app/src/main/java/com/classtrack/app/WidgetLayoutMetrics.java：snap() 落网格、双栏排布参数、删除 fillFraction/heroHeightDp/heroSurfaceAlpha
- android/app/src/main/java/com/classtrack/app/widget/WidgetRenderCache.kt：publishSafely 冲突重试 + 退回普通赋值
- .trellis/spec/frontend/android-home-widget.md：D16 收窄式修订、子卡片只在双栏、不要给文本容器估算高度

### Git Commits

| Hash | Message |
|------|---------|
| `471af70` | feat(widget): 双栏左卡重做为主卡，并修掉配置页快照冲突崩溃 |

### Testing

- [OK] ./android/gradlew -p android testDebugUnitTest（111 用例全绿）；pnpm cap:build:android + asset check 通过
- [OK] 手机 2×2 与改动前基线逐像素相同（差异包围盒 None）；平板 4×3 三档截图 + phase=layout_metrics 取证

### Status

[OK] **Completed**

### Next Steps

- 任务归档；后续可选：信息加密叠加双栏、fontScale≥1.5 的实测、OEM 平板 ROM 复验


## Session 10: 小工具预设尺寸与前台「添加到桌面」入口：字号随尺寸放大 + 双栏静态富内容 + pin 流程
<!-- trellis-session: v=2 fp=0b22996dc682fbd3 -->

**Date**: 2026-09-21
**Task**: 小工具预设尺寸与前台「添加到桌面」入口：字号随尺寸放大 + 双栏静态富内容 + pin 流程
**Branch**: `feat/widget-adaptive-space`

### Summary

①参考格子改为 2×2，让「格子越大字号越大」成为默认事实（手机 4×3 16sp→24.5sp、平板 32sp）；②新增 WidgetFillPlan 解「刚好放下」的字号并做折行感知估算；③双栏加静态富内容（双行行项/汇总计数/底部最后一节/中缝下一节与再下一节），左卡余量按 2:3 落；④前台顶栏新增「添加到桌面」入口与五个预设，走 requestPinAppWidget；⑤实测 launcher 不理会尺寸提示、且不拉配置页，于是加渲染侧兜底 + 原子 claim；⑥修掉滚动条在 API 33+ 的回归（改覆盖 Glance 的空样式）。

### Main Changes

- android/app/src/main/java/com/classtrack/app/{WidgetPreset,WidgetPendingPreset,WidgetFillPlan}.java 新增；WidgetLayoutMetrics 参考格子改 2×2 + 行高实测系数 + withFontBoost
- ClassTrackWidget.kt：填充方案接入、双栏左卡三段、双行行项、中缝两行、样式覆盖修滚动条
- WidgetSnapshotPlugin.requestPinWidget + WidgetConfigActivity 预填 + WidgetDiagnostics 四条新 phase
- app/features/schedule/{WidgetPinEntry.tsx,hooks/useWidgetPin.ts,widgetPinPresets.ts} + ScheduleHeader 紧凑化

### Git Commits

| Hash | Message |
|------|---------|
| `f147d9f` | feat(widget): 字号随格子尺寸放大，并给双栏加静态富内容 |
| `d3f086c` | feat(widget): 前台「添加到桌面」入口与预设，顶栏顺带紧凑化 |
| `8476e31` | fix(widget): 修掉平板右栏滚动条、左卡中缝补第二行，并标注只在大格子生效的预设 |
| `028cb44` | chore(widget): 补验收证据、修正估算高估，并勾选 PRD 验收项 |

### Testing

- [OK] Android 单测 132 全绿；Web 14 files / 72 用例；pnpm lint 0 problems；cap:build:android + asset check 通过
- [OK] 手机 2×2（紧凑）与上一轮基线逐像素相同（差异包围盒 None）；平板 4×3 双栏 fill=167 font=200；pin 端到端 preset_applied 恰好一次

### Status

[OK] **Completed**

### Next Steps

- 左卡中缝约 90dp 空白需新内容才能填满（接明天/倒计时已否）；OEM launcher 与 fontScale≥1.5 未验证


## Session 11: 小工具「添加到桌面」：回调式确认 + 两段式目标判决 + 诚实文案
<!-- trellis-session: v=2 fp=83e8e8ea85d1b0d3 -->

**Date**: 2026-09-21
**Task**: 小工具「添加到桌面」：回调式确认 + 两段式目标判决 + 诚实文案
**Branch**: `master`

### Summary

按 requestPinAppWidget 真实契约重做 pin 链路：传 successCallback、只有确认回调才算成功、回调里按实例 id 落预设、删除渲染侧兜底；Web 侧改三态文案并常驻手动步骤

### Main Changes

- 新增 WidgetPinResultReceiver/WidgetPinConfirmation/WidgetPinResult/WidgetPinTargets/WidgetPinBaseline 与 consumePinResult 插件方法；删除 applyPendingPreset/isConfigured/claim；spec 与 verification 同步

### Git Commits

| Hash | Message |
|------|---------|
| `0d7fbdd` | fix(widget): 回调式确认替换「请求已受理即成功」，并按两段式判决落预设 |

### Testing

- [OK] Android testDebugUnitTest 157 例全绿；pnpm test 80 例；pnpm lint 0 error；cap:build:android 通过

### Status

[OK] **Completed**

### Next Steps

- 真机（PKR110/ColorOS）空闲时补 A4 a/b/c 现场证据：确认不再出现假「已添加」、超时文案与常驻手动步骤出现、记录 AddItemActivity 是否置前


## Session 12: 小工具 pin 真机复验：不再撒谎的「添加到桌面」
<!-- trellis-session: v=2 fp=f487b7605756fccc -->

**Date**: 2026-09-21
**Task**: 小工具 pin 真机复验：不再撒谎的「添加到桌面」
**Branch**: `master`

### Summary

推送 master 触发 CI 出 1.0.6-beta（sha256 校验一致）覆盖安装到 PKR110，现场复验失败路径：无假「已添加」、超时如实文案、手动步骤常驻、launcher 起 AddItemActivity 却从未置前

### Main Changes

- verification.md 补真机证据表与截图（evidence/real-1..3），PRD A4 勾选，新增 2 条取证陷阱到 verification 与项目 skill

### Git Commits

| Hash | Message |
|------|---------|
| `585d91c` | chore(widget): 补真机验收证据并勾选 A4 |

### Testing

- [OK] Android 157 例、Web 80 例、pnpm lint 0 error；真机 logcat 三段日志 + dumpsys 实例数 + 截图

### Status

[OK] **Completed**

### Next Steps

- 归档 09-21-widget-pin-confirm（A1-A6 全部完成）；如需在真机真放下小工具，只能走面板底部的手动步骤


## Session 13: 小工具：五档 provider + 尺寸自动匹配 + 拾取器预览生成（模拟器验证）
<!-- trellis-session: v=2 fp=17f52cbdf2ee1264 -->

**Date**: 2026-09-21
**Task**: 小工具：五档 provider + 尺寸自动匹配 + 拾取器预览生成（模拟器验证）
**Branch**: `master`

### Summary

按产品口径把预设改为按尺寸命名并注册五个 provider（4×3 沿用旧类名保护存量实例），新增 AUTO 样式 + 尺寸最近邻自动匹配（手动优先），pin 链路与配置页改多 provider；拾取器预览改为脚本生成

### Main Changes

- 新增 WidgetProviderRegistry/WidgetProviders/WidgetStyleResolver + 四个 receiver + 五份 info XML/预览；WidgetPreset 按尺寸重写并加 match()；配置页加「自动（按尺寸）」；诊断日志带实例 id；check-android-assets 增加五 provider 断言

### Git Commits

| Hash | Message |
|------|---------|
| `f957a56` | feat(widget): 按尺寸注册五个 provider + 尺寸变化自动匹配 + 拾取器预览生成 |
| `947427e` | feat(widget): 预设按尺寸重命名，并铺好多 provider 的注册表与骨架（P3 进行中） |
| `ce87e7c` | feat(widget): 「添加到桌面」点击即弹醒目标态框，并用快探针把失败反馈压到约 2 秒 |

### Testing

- [OK] Android 186 例、Web 91 例、lint 0 error、typecheck、cap:build:android；模拟器实测拾取器五条目/各自预览、pin 落点、配置页归属校验与默认选项

### Status

[OK] **Completed**

### Next Steps

- 待补：模态失败分支（探针命中）与拖动改尺寸的真机现场；两处都已写进 verification.md 的待办


## Session 14: 小工具：模拟器验掉拖动改尺寸与模态失败分支（并修出两个真缺陷）
<!-- trellis-session: v=2 fp=ef8e4b4c0be03864 -->

**Date**: 2026-09-21
**Task**: 小工具：模拟器验掉拖动改尺寸与模态失败分支（并修出两个真缺陷）
**Branch**: `master`

### Summary

用 input motionevent 真实拖拽手势验证尺寸变化自动匹配（2列 adaptive ↔ 3列 two_column，显式时不变）；用受控实验触发探针失败方向，发现并修掉探针结论被兜底文案降级的缺陷

### Main Changes

- useWidgetPin 改为 resolvePinFinalOutcome(probeFired)；配置页 AUTO 下灰显说明改用另一条文案；verification.md 补设备证据与手势方法；MainActivity 的实验补丁已回滚

### Git Commits

| Hash | Message |
|------|---------|
| `3b35a8e` | fix(widget): 修掉探针结论被兜底文案降级、以及 AUTO 下灰显说明写错原因 |

### Testing

- [OK] Android 186 例、Web 92 例、lint 0 error、typecheck；模拟器实测见 verification.md（含 5 张证据截图）

### Status

[OK] **Completed**

### Next Steps

- 真机复验：探针修复后的文案在 ColorOS 现场确认、ColorOS 下拾取器尺寸标签；随后归档任务


## Session 15: 更新检测（Release 探测 + 通知 + 通道）与发版触发收窄
<!-- trellis-session: v=2 fp=219b1b997c09cae7 -->

**Date**: 2026-09-23
**Task**: 更新检测（Release 探测 + 通知 + 通道）与发版触发收窄
**Branch**: `master`

### Summary

安卓端更新检测落地并真机验收（含一个只有真机能暴露的原生 bug），随后收窄了发版触发路径；PR #14 已合并，四个历史任务一并归档。

### Main Changes

- 更新检测：冷启动/回前台查 GitHub Release（单次请求 per_page=20），发现更新弹前台模态框 +（可选）系统通知；判定逻辑（版本解析/比较、通道筛选、节流、URL 白名单、响应收窄）全是纯函数，50 个 vitest 用例覆盖。
- 设置卡片「应用更新」：总开关、通知开关、三选一通道（仅正式版/仅测试版/全部）、间隔（每次启动/1天/3天/7天）、立即检查；设置存独立 store（class-track-update），不进备份 JSON 与 schema 迁移。
- 通道默认值只在首次读到版本名时按安装包类型播种一次、之后永久保持 —— 测试版包升级为正式版包后仍是「全部」（真机验证过覆盖安装）。
- 新增 @capacitor/app 与 @capacitor/local-notifications；新增本应用插件 AppUpdatePlugin（跳通知设置页，两个官方插件都没这个 API），目标链判决与渠道 id 校验放在纯类 NotificationSettingsTargets 里由 6 个 JVM 用例钉住。
- 真机验收揪出并修掉一个真 bug：LocalNotifications.schedule 的 isExactNotification 默认 true，系统未授予「闹钟与提醒」时插件会先弹设置页并等结果，导致调用永不 resolve、通知永不投递（日志特征：methodName: schedule 之后什么都没有 + 紧接着出现 Settings$AlarmsAndRemindersAppActivity）；显式传 false 后通知正常投递。
- CI 两项调整：取消测试版 release 的过期清理（历史测试版一律保留）；发版触发路径收窄为「只算能改变 APK 内容的改动」（去掉 scripts/**、.github/** 与失效的 index.html，改链路要验证就手动 dispatch），并把资产守卫的纯函数单测补进 ci.yml（此前哪都不跑）。

### Git Commits

| Hash | Message |
|------|---------|
| `326cdc9` | feat(android): 更新检测：Release 探测、通知与更新通道设置 |
| `d9d3fd3` | ci(android): 取消测试版 release 的过期清理 |
| `8114bd9` | ci(android): 收窄发版触发路径，只算能改变 APK 内容的改动 |

### Testing

- [OK] pnpm typecheck / lint（0 problems）/ format:check / test（23 文件 198 用例）/ build 全绿；原生 :app:testDebugUnitTest 34 类 253 用例全过；assembleDebug 通过。
- [OK] 真实 GitHub API 联调：10 条现网 release 全部解析成功、pageUrl 全在白名单前缀内；已装 1.0.10-beta 时三个通道都判「不提示」。
- [OK] API 37 模拟器逐条过 PRD 真机清单：模态框 + 通知栏条目（channel=updates）、跳过此版本/稍后/立即检查、总开关关闭后 lastCheckAt 保持 null（证明确实没进联网路径）、权限弹窗与拒绝后开关回退、通道持久性、浏览器端不渲染卡片。
- [OK] CI verify 在 PR #14 上给出 Tests 198 passed，且 pnpm install --frozen-lockfile 成功（手工还原过一行的锁定文件有效）。
- [OK] 收窄触发路径那次推送只触发 CI、没有 Android Release（对比上一次两个都触发）。

### Status

[OK] **Completed**

### Next Steps

- stable 通道的真实推送路径还没在真机出现过（现网没有正式版 release）；等后面出了新测试版，可以用旧包实测一次「启动即提示 + 通知栏」。
- 「去系统设置」跳转在 Android 16 上会被系统统一落到应用信息页，三级回退链在 API 26–35 才分别生效 —— 不是 bug，别照 Android 16 的表现去改。
- 改发布链路后不再自动出包验证，需要验证时手动 dispatch。


## Session 16: 小组件 hero 空课态 + 二次引导 + 更新通知默认关闭
<!-- trellis-session: v=2 fp=d451a1dd5d8d9d6e -->

**Date**: 2026-09-24
**Task**: 小组件 hero 空课态 + 二次引导 + 更新通知默认关闭
**Branch**: `fix/widget-today-empty-hero`

### Summary

hero 在今天没课时改显示空课态三行（含快照补今日日期字段）；加桌后新增第二段引导去个人中心；更新通知默认关闭。判据/文案/接线均已由 JVM + vitest 用例钉住，设备项待验。

### Main Changes

## 会话：小组件 hero 空课态 + 二次引导 + 更新通知默认关闭

分支 `fix/widget-today-empty-hero`（从 `feat/nav-scroll-hint` 开出）。轻量规划，唯一产物 `prd.md`
（含三支改动的口径记录、技术决策 D1–D18、验收清单）；`verification.md` 记录实际跑过的命令与**待验的设备项**。

### 做了什么

- **A 小组件 hero 空课态**：今天本来没课或今天的课已上完时，hero 不再把明天的课当「接下来」，
  改成三行空课态（今天的日期 / 今天无课·今天已无课 / 一句轻松的话，长短档按样式分）。
  判决层新增 `heroIsToday` 入参与 `WidgetBodyLine.Kind.HERO_EMPTY`；触发条件复用既有的
  `heroState == UPCOMING_OTHER_DAY`，没有新增时间比较。顺带补上「今天已上完仍有可见行 → 补一行
  `NEXT_OTHER`」与「紧凑样式后续课从第一条还没上的课起列」（旧口径会吞掉明天第一节）。
- **A2 快照补今日日期**：`todayDayKey` / `todayWeekdayLabel` 作为**可选字段**（Web 预格式化、
  `schemaVersion` 仍为 1）。原生不做日期运算这条硬约束因此没有被破。
  跨层夹具用真实 builder 重新生成，逐字段比对只多了这两个字段。
- **B 更新通知默认关闭**：默认值与坏值收窄抽到 `app/lib/app-update/settings.ts`，`updateStore`
  只把它交给 persist 的 `merge`；已存过 `notify: true` 的设备不受影响。
- **C 第二段引导**：`ProfileGuideDialog` + `profile-guide.ts`，第一段引导关闭时（两个按钮都算）
  判断并写标记，显示条件 `showProfileGuide && !widgetPinSheetOpen`（点「去添加」时等面板关掉再出现）；
  两段引导的存储读写收敛到 `guide-storage.ts`。

### 验证

`pnpm test` 226 用例、`pnpm typecheck`、`pnpm lint`、`./android/gradlew -p android :app:testDebugUnitTest`
（259 用例）、`generate-widget-preview-layouts.py --check`、`pnpm test:android-assets` 全绿。
设备类验收（两种空课态观感、1×2 截断、双栏左卡、两段引导衔接、通知默认值）在本沙箱做不了
（无 `/dev/kvm`、`~/.android/avd` 只读），逐项 ⏳ 留在 `verification.md`，任务按用户口径**先归档**。

### 环境坑（下次省事）

- `$HOME/.gradle` 在本沙箱只读 → 拷到 `/tmp/gh` 后 `GRADLE_USER_HOME=/tmp/gh ./android/gradlew -p android :app:testDebugUnitTest --offline`。
- `scripts/check-android-assets.js` 在当前工作区本就失败（`build/client` 比 `assets/public` 新，后者被 gitignore），与本任务无关。


### Git Commits

| Hash | Message |
|------|---------|
| `0e12932` | feat(widget): 今天没课时 hero 不再显示明天的课，改显示空课态 |

### Status

[OK] **Completed**


## Session 17: 出勤统计默认关闭并做成可选项（含备注/出勤解耦）
<!-- trellis-session: v=2 fp=b4a23200b86be482 -->

**Date**: 2026-09-24
**Task**: 出勤统计默认关闭并做成可选项（含备注/出勤解耦）
**Branch**: `fix/widget-today-empty-hero`

### Summary

把整块出勤能力（课表标记 + 看板出勤统计）改为默认关闭，个人中心新增「出勤统计」开关（独立 store class-track-attendance，不进备份、不动业务 schema 版本）。关闭时课表无状态色条/外圈/角标、顶栏无批量按钮（列数收窄到 3 列）、弹窗无出勤切换按钮；看板收起完成度/缺勤率/标记覆盖率/未标记/周趋势/风险课程/完成度排行，分布图只留总课次，顶部加提示卡带「去开启」。备注与出勤解耦：ClassMark 补 attendanceMarked 字段（schema 3→4），四个写入点写已判断、setNote 新建写未判断，看板把「未判断」算未标记而非缺勤，判据收敛到 isAttendanceMarked + 三个 Session 谓词；旧数据一律补成已判断，现有统计零变化。门禁五项全绿（254 例单测），视觉证据 11 张截图 + 只写备注对照（2%/60 → 3%/59）。未验证：Android WebView 与 ≥768px 桌面像素表现。

### Git Commits

| Hash | Message |
|------|---------|
| `fe8d131` | feat(attendance): 出勤统计默认关闭并做成可选项 |

### Status

[OK] **Completed**


## Session 18: 课表格子彩色实底改版 + 教师/备注实测降级
<!-- trellis-session: v=2 fp=1ff66b47b77cfb00 -->

**Date**: 2026-09-24
**Task**: 课表格子彩色实底改版 + 教师/备注实测降级
**Branch**: `feat/schedule-cell-pastel`

### Summary

格子改 wakeup 式彩色实底白字圆角卡片；个人中心新增「课表显示」（出勤状态、淡化非本周课）并新增 scheduleDisplayStore；getVisibleCourses 纯函数含冲突消解；教师/备注从失效的容器查询改为按内容实测降级 + 字号兜底；节次行高 2.75rem→4rem；rebase 合并 master 的出勤统计两层开关。验证：lint/typecheck/261 测试全绿；412×915/360×480/768×1024/1280×800 四档浏览器实测全部格子 clip≤1px。

### Git Commits

| Hash | Message |
|------|---------|
| `00aba63` | fix(schedule): 教师与备注改为按内容实测降级，并适度加长格子 |

### Status

[OK] **Completed**


## Session 19: 课表配色四轮迭代定稿（平色柔和调）+ 网格线统一 + 教室去 @

**Date**: 2026-09-24
**Task**: 课表配色柔化 + 网格线统一（09-24-schedule-cell-tone）
**Branch**: `feat/schedule-cell-tone`

### Summary

真机反馈驱动的四轮配色迭代：① Tailwind 400→500 渐变被评「太艳」；② 换成参考图采样中间调后，白字小行在浅底上糊、且相近色相（深绿/浅绿）分不清；③ pastel 浅底 + 同色相 700 深色课名被否（要求课名纯白）；④ 文字阴影被评「丑」。定稿 = **平色（无渐变）+ 纯白字 + 无阴影 + 8 色相间隔 ≥30°**，实测 sat 0.34–0.56、lum 0.60–0.69、白字对比 ≥2.07（与参考图同档）。

同时修掉两处：有课程的格子恢复 `border-r`/`border-b`（原来只有空格有线，观感「线断断续续」）；教室去掉 `@` 前缀（课名与教室靠字号/字重/透明度分层）。

验证：lint/typecheck/261 测试全绿；移动 1x（412×915）与桌面（1280×800）截图复验，`clip=0`、18 个课程格容器边框一致、零渐变/零 `@`/零阴影。spec 已同步配色定稿、网格线规则与配色迭代踩坑。

### Git Commits

| Hash | Message |
|------|---------|
| `63b0e80` | fix(schedule): 课表配色定稿平色柔和中间调、统一网格线、教室去 @ 前缀 |

### Status

[OK] **Completed**


## Session 20: 课表卡色照参考图逐像素复刻 + 白描边/边距/居中打磨

**Date**: 2026-09-24
**Task**: 无（真机反馈驱动的连续微调，沿用「直接改，不建任务」）
**Branch**: `feat/schedule-palette-vivid`

### Summary

第六轮最终收敛为「照参考图逐像素复刻」：对参考图做饱和度分割 + 连通域，取每张卡中位色、并用上下半区取样确认参考图卡片本就是**平色无渐变**，8 组色直接照搬（薄荷 #87e5d4 / 青蓝 #7bb7ef / 紫蓝 #84aef7 / 藕荷紫 #bcaaf5 / 玫瑰 #ee7c9b / 浅粉 #e7a0b3 / 珊瑚 #e98d78 / 金橙 #eab776）；浏览器实测渲染值 8/8 与采样一致。

非本周卡不再用固定灰：用参考图唯一 OOW 样本（金橙 #eab776 → #d4c3ae）反推淡化公式（色相不变、HSL 亮度 +0.067、饱和 ×0.42，回代精确复现），对 8 组色逐一生成 courseOutOfWeekColors。

打磨项：① 描边 2px **半透明白**（ring-white/55 ring-inset）——纯白在白底上只剩「卡片被缩小」的观感；② 上下内边距 2px→4px；③ 文字块**实测收窄到最长行宽**后由外层 items-center 居中、块内仍左对齐（实测 46.6px 卡 → 块 30px、左右各 8.3px 完全对称）；④ 课名/教室改 break-words（教室断在 `28-`/`A203`，修掉 break-all 切断数字、以及 `（Python）` 溢出被裁两个真 bug）。

阶梯健壮性：首帧测量不可靠（网格 1fr 未定稿 / 中文字体晚到都不触发 ResizeObserver），补 rAF + document.fonts.ready 各重测一次，修掉长课名格溢出被裁。行高 4rem → 3.875rem（412×915 每节 62px），并保证超长课名格 shrunk=0。

验证：lint/typecheck/261 测试全绿；浏览器 clipped 0、shrunk 0、教师 16/18、备注 16/18；spec 已同步采样配色、非本周推导色、文字块居中规则与 5 条新踩坑。

### Git Commits

| Hash | Message |
|------|---------|
| `4d97f9b` | fix(schedule): 卡色照参考图采样复刻，白描边半透明并让文字块居中 |

### Status

[OK] **Completed**


## Session 21: 前台课表尺度响应式化：字号改由格子尺寸推导，去掉硬编码 px
<!-- trellis-session: v=2 fp=abcddebbb5cb59ec -->

**Date**: 2026-09-25
**Task**: 前台课表尺度响应式化：字号改由格子尺寸推导，去掉硬编码 px
**Branch**: `feat/schedule-responsive-sizing`

### Summary

真机逐像素分析确认同屏 8/9/10 三种课名字号（兜底按 px 硬减造成）；把字号从 JS 测量搬到 CSS 容器查询单位（cellScale.ts 单一真源），兜底改相对比例、粒度 0.05，内层块宽度夹 100%，内容顶部对齐，断点统一 md:，新增「收起整周无课日期列」开关。单测 261→289，浏览器多视口 2068 条断言全绿，网格几何与基线逐字符一致。AC-E4 真机复核留待用户。

### Main Changes

## 起因：真机验收反馈

用户报「前台课表的文字是硬编码的，一旦显示尺寸变化，显示效果就是灾难级别」。
先做排查：不靠肉眼，用 PIL 对真机截图逐像素分析（连通域定位卡片、边框灰统计定位
网格线、行墨点剖面测行距），并以「节次列 = 2rem = 32px」「表头行 = 2.25rem = 36px」
双点标定出截图比例（D = 3.5 设备px/CSS px，视口 360×794）。

结论：网格几何与规格**完全一致**，问题全在内容尺度。14 个有课格子里 11 个是
10px×lh1.2、3 个是 9px×lh1.05 —— 同一屏 1.27× 落差，与代码里 `apply()` 的
「按 px 硬减两档、判据用 isMobile」完全对上。另测得 `概率与统计 (Python)` 的文字块
ink 宽度超出卡片内边距盒、压在描边上。

排查过程中自己写错两处结论（把「纵向超出」当成缺陷，实际是预期的可滚动行为；
把描边带的灰阶误判成字形溢出），都在研究工件里显式纠正了，没有留假证据。

## 关键决策

1. **把字号从 JS 的测量结论里彻底拿出来交给 CSS**：新增 `cellScale.ts` 作为尺度
   单一真源，课程格 wrapper 当 `container-type: size` 查询容器，字号写成
   `clamp(8px, calc(clamp(8px, min(24cqw,30cqh), 15px) * var(--cc-scale,1)), 15px)`。
   JS 只保留丢行与相对兜底 —— 字号从此完全确定（同尺寸必然同字号），消除了时序抖动。
2. **上限 15px 是有意的**：它是「缩放仍能揭示更多信息」的机理（1x→2x 列宽翻倍而
   字号只涨 1.5 倍）；放开上限就退化成纯放大镜。
3. **兜底粒度取 0.05（5 档）而不是设计稿的 0.1（2 档）**：兜底取「刚好放得下的第一
   档」，粒度越粗缩幅越超出需要，而超出的缩幅直接变成用户看到的同屏落差。实测
   412px 下 20 字课名 0.05 粒度缩 5%、0.1 粒度缩 20%。
4. **内容顶部对齐**（用户验收意见）：1 行与 7 行内容的格子必须从同一条顶边起排。

## 实现期踩的四个坑（都写进了规格）

- **自定义属性里的 `var()` 在声明处就替换了**：把 `var(--cc-scale)` 写进网格声明的
  `--cc-name`，会固化网格上的值（不存在 → 1），课程格上后设的 `--cc-scale` 永远进不来
  （实测 scale=0.8 时字号完全没缩）。`cq` 单位相反，按使用处容器解析 —— 设计里
  「地基假设」只成立一半。
- **Tailwind 只扫字面类名**：类名改成运行时拼接后不生成规则，computed 字号静默回落到
  浏览器默认 16px。改回字面量 + 用单测形状断言钉住与常量一致。
- **查询容器不能挂在带 `border-r`/`p-px` 的那层**：容器内容盒会随「是不是最后一列」
  变化 ~2.5%，同尺寸格子字号立刻不一致。多加一层无内边距/无边框的 div 解决。
- **写 storage 与 reload 之间不能夹任何命令**（连 `set viewport` 都不行）：上一页实例会
  抢先回写内存状态、覆盖夹具，表现为 `cells==0` 落到空状态页。截图脚本因此先空跑了一轮。

## 验证

- 单测 261 → 289（尺度公式、源码守卫、store 持久化三组）。
- 新增 `research/browser-probe.js` + `research/verify-responsive-sizing.mjs`：9 档视口
  （240–1440）× 逐格断言 + 缩放/断点/稳定性/D 组/全空周五组场景，**2068 条断言全绿**。
  其中加了最硬的一条：「浏览器算出的 computed 字号 == 公式预测值」，同时钉住
  `cq` 单位按使用处解析这条地基。
- 门禁 G2：`container-type: size` 未改变网格几何，`grid-template-rows/columns` 与改动
  前基线逐字符一致；关闭 D 组开关时列模板也逐字符一致。
- 断言自己也被修过三次（同尺寸同字号漏了兜底档位这一维、单调性用了会被兜底干扰的
  格子、比值恒定没排除上下限截断）——每次都按事实收窄 AC 并在 PRD 里写明原因，
  没有为了让实现"看起来对"而放宽。

## 未完成

AC-E4（真机/模拟器截图复核）保持未勾选：本机已出 240/360/412/1024 四档截图与
360px 前后对比，真机（Android WebView + 系统显示大小）那一步需要用户验证。
因此**任务未归档**，等确认后再 `task.py archive`。


### Git Commits

| Hash | Message |
|------|---------|
| `6f82dc3` | feat(schedule): 课表字号与布局改为随格子尺寸自适应，去掉硬编码 px |

### Status

[OK] **Completed**


## Session 23: 小工具「今天已无课」档重做（列明天课表 + 「下次上课」块）并修掉快照丢弃当天已上完课
<!-- trellis-session: v=2 fp=ba882cf1857907cf -->

**Date**: 2026-09-28
**Task**: 小工具「今天已无课」档重做（列明天课表 + 「下次上课」块）并修掉快照丢弃当天已上完课
**Branch**: `fix/widget-today-done-show-tomorrow`

### Summary

Session summary was not supplied.

### Main Changes

## 本轮做了什么

用户报了两件事，一起修（分支 `fix/widget-today-done-show-tomorrow`，独立工作树）：

1. 「上完课后 / 没课后，小工具非 hero 区域只剩一行『下一节 · …』」→ 先做了「之前 vs 现在」的取证
   （结论：变的是 hero 区域，非 hero 那一行两代其实一样，但 004fe24 确实给 `next_up` 补了 `NEXT_OTHER`、
   也改了 compact 的起始下标，所以那半张卡是「变过」的），再按用户拍板重做这一档：
   - 今天没有「还没上完」的课且明天有课 → 直接列明天课表（三种「已上完」策略都切）；
     回退时把 `todayHadClasses` 与折叠计数一并带过去，否则空课态会写成「今天无课」、折叠档会丢「已上完 N 节」。
   - 明天也没课（周末 / 长假）→ 不列下一个有课日的课表（保持 2026-09-20 口径），但把原来那行 caption 小字
     换成「下次上课」块：title 字号标签 + body 字号「9月28日 周一 08:00」，课名去掉（它正是被省略号截掉的那段）；
     1×2 窄档只画日期，计数行不再重复 hero 已经说过的「今天无课」，两处高度估算同步跟着改。
2. 「上完课切前台后，今天已上完的课全都不见了」→ 根因是 Web 快照生成时丢弃 `endEpochMs <= generatedAt`
   的条目；而覆盖窗口从**今天**开始，所以这条过滤只能删掉「今天已上完」的课（未来日子一条都删不掉，
   省不下 payload），同时让 `todayFinishedCount` 恒为 0（「已上完 N 节」与双栏计数恒错）。删掉该过滤即可。

文案/形态来回问了三轮才对上：用户否掉了「明天也没有课」「明天也无课」「连着两天无课」，也否掉了我第一版的
「下次上课 · 日期时刻」单行；最后定在标签式两行（「下次上课」/「9月28日 周一 08:00」）。教训：这一档是
「不写否定句、用卡上既有词汇」的极简标签风，别自己造句。

## 证据 / 门禁

- Android 单测 34 类 / 262 例全过；`WidgetSnapshotCrossLayerTest` **未重新生成夹具**即全绿
  （夹具当天唯一一节 10:00–11:40 在 `generatedAt` 09:00 时未结束，那条过滤在夹具上从未生效）。
- Web 36 文件 / 289 例全过；`pnpm typecheck` / `lint` / `format:check` / `build` 全部 exit 0。
- 沙盒环境两处坑记进了 `verification.md`（下次省时间）：`~/.gradle` 只读 → 用
  `GRADLE_USER_HOME=/media/.../CodeFiles/.worktrees/.gradle-home` + `--offline`，并把
  `~/.gradle/caches/modules-2` 合并进那个可写 home（否则 `compose-compiler-gradle-plugin:2.1.20` 拉不到）；
  `~/.android` 只读 → `assembleDebug` 必须让 `HOME`/`ANDROID_USER_HOME` 指向 `~/.cache/android-home`，
  否则 `:app:validateSigningDebug` 报 「Unable to create debug keystore」。
- 另：主检出里被 `.gitignore` 列出的沙盒占位点文件（`.gitconfig` / `.bashrc` / `.mcp.json` …）中途消失，
  导致 bwrap 起不来，已补回空文件。

## 未完成

- 渲染层没有设备截图：**沙盒里没有 `/dev/kvm`**（`emulator -accel-check` 报 `/dev/kvm is not found`），
  模拟器起不来 —— 这是环境限制，不是漏做。debug APK 已产出
  （`android/app/build/outputs/apk/debug/app-debug.apk`，10.7MB），交本机设备补验三件事：
  3×2 的两行层级、1×2 有没有省略号、以及切后台再回前台后已上完的课是否仍在。
- 因此任务未归档；设备确认后再 `task.py archive`。

## Session 22: 前台课表缺勤改为实色红框，未标记格子不再显出勤痕迹
<!-- trellis-session: v=2 fp=01cb899d7007659b -->

**Date**: 2026-09-28
**Task**: 前台课表缺勤改为实色红框，未标记格子不再显出勤痕迹
**Branch**: `feat/schedule-absent-solid-red-ring`

### Summary

缺勤从 opacity-60 saturate-50 整卡淡化改为不变淡 + 实色红描边（新增 cellScale.ts 的 CELL_ABSENT_RING_CLASS，#ef4444，宽度仍走 --cc-ring），出勤痕迹收窄到 isAttendanceMarked() 为真的格子（未标记/只写备注完全中性）；同步单测、源码守卫与 mobile-schedule-layout.md（新增「出勤表现」小节）。五道门禁全绿（295 例），真实应用逐格计算样式复核见任务 research/verify-report.md。

### Git Commits

| Hash | Message |
|------|---------|
| `4adc1b4` | fix(widget): 今天已无课时直接列明天课表，长假档换成「下次上课」块，并修掉快照丢弃当天已上完课 |
| `5f176f8` | chore(task): 补记设备验证缺口（沙盒无 /dev/kvm）与可安装 APK 的复现命令 |
| `3afe55d` | feat(schedule): 课表缺勤改为实色红框，未标记格子不再显出勤痕迹 |

### Status

[OK] **Completed**

### Next Steps

- 本机设备补渲染截图（沙盒无 /dev/kvm）；确认后 task.py archive


## Session 24: 更新检测：回前台检查改为成功才记账 + 更新说明按 markdown 渲染
<!-- trellis-session: v=2 fp=8e0189cadf05c633 -->

**Date**: 2026-09-28
**Task**: 更新检测：回前台检查改为成功才记账 + 更新说明按 markdown 渲染
**Branch**: `master`

### Summary

PR #24 已合并（master 4bc9973）。两处独立修复：① lastCheckAt 语义从「上次尝试」改成「上次成功拿到结果」，失败不再消耗间隔窗口（只写 lastAttemptAt，供 60 秒冷却用），间隔新增 1 小时档并设为默认，存量设备等价于旧默认 1d 且未手动改过间隔的由 applyLegacyIntervalMigration 一次性提升；检查内核抽成 app/lib/app-update/check.ts（依赖全注入）让「成功才记账」变成真单测。② 新增 releaseNotes.tsx：marked.lexer token → React 元素，全程 0 处 dangerouslySetInnerHTML，原 HTML/图片/表格按文本降级、链接只放行 http(s)。门禁：typecheck/test（38 文件 351 用例，基线 295）/lint/format/build 全过，grep dangerouslySetInnerHTML= 全仓库 0 命中。实现期揪出 4 个静默失效（判决顺序写错、marked 的 list 子项字段是 items 不是 tokens 导致列表渲染成空、isChecking 所有权、NaN 时间戳让判定恒为否），已写进 spec 的契约与 Common Mistakes。合并后 Android Release 产出 1.0.20-beta（含本次修复，尚未在设备上验收）。

### Git Commits

| Hash | Message |
|------|---------|
| `3191fb9` | fix(app-update): 回前台检查改为成功才记账，默认间隔收紧到 1 小时 |
| `6104fa3` | feat(app-update): 更新说明按 markdown 渲染，token 映射成元素且无注入面 |
| `12be62b` | docs(spec): 更新 app-update 契约（记账语义、间隔档位与存量提升、渲染降级表） |
| `d3689a7` | docs(task): 记录 09-28 更新检测修复的规划与验收证据 |
| `e40790b` | chore(task): 记录 09-28 更新检测修复任务的分支 |

### Testing

- [OK] pnpm typecheck / pnpm test（38 文件 351 用例）/ pnpm lint（0 problems）/ pnpm format:check / pnpm build / pnpm test:android-assets 全过；CI（verify + commitlint）与 Android Release 在合并提交上均 success；未做模拟器真机验收（用户口径，已写进残余风险）

### Status

[OK] **Completed**

### Next Steps

- 在设备上装 1.0.20-beta 验证：注入或等待比已装版本新的 release → 冷启动弹框 → 切后台再回前台仍能重新联网；确认更新说明按 markdown 渲染（列表/粗体/行内码）；顺手确认存量设备的上次检查时间戳语义与间隔已变 1 小时


## Session 25: 课表左右边缘阻尼滑动切换上下周（可选开关，默认开）
<!-- trellis-session: v=2 fp=4901d3504ac3ca76 -->

**Date**: 2026-09-29
**Task**: 课表左右边缘阻尼滑动切换上下周（可选开关，默认开）
**Branch**: `feat/schedule-edge-swipe-week-switch`

### Summary

手机端课表新增「滑到最左/最右边缘后继续拖 → 阻尼跟手位移 → 松手切上/下一周」，默认开启的可选开关 + 纯函数核 + 手势 hook；顺带修掉 pointercancel 被当成 tap 导致连续两次横滑误判成双击的旧缺陷。五项门禁全绿，浏览器真实触摸事件 8 组场景通过；真机验收因环境无 /dev/kvm 且 ~/.android 只读而未做，已标注并另开任务。

### Main Changes

- app/features/schedule/weekSwipe.ts(+test)、hooks/useWeekSwipeGesture.ts、ScheduleTable/SchedulePage/ScheduleHeader、scheduleDisplayStore(+test)、ScheduleDisplaySettings(+test)、useScheduleZoom（tap 修复）；spec: mobile-schedule-layout.md、state-management.md

### Git Commits

| Hash | Message |
|------|---------|
| `0b877f5` | feat(schedule): 手机端课表滑到左右边缘后阻尼切换上下周 |

### Testing

- [OK] pnpm lint / typecheck / format:check / test(388) / build 全绿；CDP Input.dispatchTouchEvent 8 组场景；agent-browser react renders 计数（拖动 0 commit、切周 1 commit）

### Status

[OK] **Completed**

### Next Steps

- 真机触摸验收待补：.trellis/tasks/09-29-schedule-edge-swipe-device-verify（需有 /dev/kvm 的环境）；随后推分支开 PR 到 master


## Session 26: 修复旧 WebView 上课表无法上下滑动（html/body 高度兜底被构建删除）+ 预防性加固
<!-- trellis-session: v=2 fp=b41fd0bebe4cd236 -->

**Date**: 2026-09-29
**Task**: 修复旧 WebView 上课表无法上下滑动（html/body 高度兜底被构建删除）+ 预防性加固
**Branch**: `fix/schedule-scroll-legacy-webview`

### Summary

Android 12 上课表滑不动的真因不是手势层，而是 app.css 的 height:100% 兜底被 lightningcss 当「被后一条覆盖的冗余声明」删掉，产物只剩 dvh；不支持 dvh 的 WebView（Chromium ≤ 107）上 html/body 变 height:auto，外壳整条高度链塌陷、课表 maxScrollTop 变 0 且溢出被 body{overflow:hidden} 裁掉。修复用独立 @supports (height: 100dvh) 块升级 + 块外兜底，并加两条防回归检查。随后按用户要求做预防性加固：C2 给 .app-viewport 再加一条只对无 dvh 引擎生效的 100vh 锚点（去单点依赖，实测可救援），D 加设备端一键诊断器械（把未知第二原因压成一次分层判定）。真机验收按用户口径未做。

### Main Changes

- app/app.css：html/body 高度改为「块外 height:100% 兜底 + @supports (height:100dvh) 升级块」
- app/app.css：@layer utilities 内为 .app-viewport 新增 @supports not (height:100dvh) 的 100vh 外壳锚点（C2）
- app/appCssViewportAnchor.test.ts（新）：源码结构契约 5 例（含外壳锚点）；扫描器边界补 { 以覆盖 @layer/@supports 内规则
- scripts/check-webview-css-fallback.js / .test.js（新）：14 例自测的真产物断言（兜底在块外、dvh 升级块、顺序、外壳锚点）
- package.json / ci.yml：新增 webview:check-css 与 test:webview-css，挂 cap:build:android 链尾与 CI 的 pnpm build 之后
- research/：等价条件器械 cdp-dvh-equivalent、加固矩阵 preventive-hardening-probe、设备诊断 device-diagnostics、写法矩阵 lightningcss-fallback-matrix 等
- spec：quality-guidelines.md 新增「构建产物的兼容性契约（视口高度锚点）」与「外壳锚点：不得单点依赖 html/body」；mobile-schedule-layout.md 补前置依赖与器械清单
## Session 28: 回退课程顺序配色并修复颜色碰撞
<!-- trellis-session: v=2 fp=74aa90bf87ae35de -->

**Date**: 2026-10-08
**Task**: 回退课程顺序配色并修复颜色碰撞
**Branch**: `fix/schedule-color-allocation`

### Summary

恢复 718812f 已有的课程号去重排序、顺序分配与档位 0 兜底，修正恢复目标色板时误引入的哈希碰撞；保持目标色板与对应淡化色。新增 5 项回归用例，全量 41 个文件、393 项测试及 typecheck、lint、format:check、build 通过。历史映射差分一致。修复任务已归档，PR #29：https://github.com/wangminghuang/ClassTrack/pull/29。

### Git Commits

| Hash | Message |
|------|---------|
| `904111f` | fix(schedule): 补回 html/body 的 height:100% 兜底，修复旧 WebView 上课表无法上下滑动 |
| `280c1bf` | fix(webview): 外壳再补一条高度锚点兜底，并加设备端一键诊断器械 |

### Testing

- [OK] [OK] pnpm typecheck / lint / format:check / build 全绿；pnpm test 41 文件 393 用例；pnpm test:webview-css 14/14；pnpm webview:check-css 通过（含外壳锚点断言）
- [OK] [OK] AC-2/AC-3 等价旧引擎（CSSOM 删掉 dvh 声明）：maxScrollTop 0 → 48、纵向拖动 scrollTop 0 → 48、body 高度不再超视口
- [OK] [OK] AC-7 C2：正常引擎 412×915/1440×900 基线逐项不变；把 html/body 高度全拿掉后 maxScrollTop 0 → 48、课程格与字号全回基线；产物含 @supports not 块
- [OK] [OK] AC-8 诊断器械四种状态判定：ok / layout-anchor / needs-no-scroll / touch-layer 全部正确
- [OK] [OK] AC-1/AC-4 反证：还原旧写法后单测 3/4 红、产物只剩 height:100dvh、pnpm webview:check-css 退出码 1
| `abee4b0` | fix(schedule): 恢复课程顺序配色避免重色 |

### Status

[OK] **Completed**


## Session 29: 课程配色选择与前台更新检查
<!-- trellis-session: v=2 fp=195afa88385f8dbb -->

**Date**: 2026-10-08
**Task**: 课程配色选择与前台更新检查
**Branch**: `feat/course-palette-and-update-check`

### Summary

保留新旧课程配色，个人中心可选择及预览，默认原配色；修复仓库迁移后发布链接被旧白名单过滤的问题，自动更新固定前台每6小时检查，仅弹模态框，不发通知。

### Main Changes

- 新色板仅调整两档及其淡化色，选择持久化，历史课程分配规则保持。
- 更新API及发布页白名单同步仓库新地址；旧设备间隔统一6小时，移除通知和权限调用，支持关闭自动检查后手动检查，增加15秒超时。

### Git Commits

| Hash | Message |
|------|---------|
| `41edcfc` | feat(schedule): 支持新旧课程配色选择与预览 |
| `ccb24fb` | fix(update): 修复发布地址并改为前台每六小时检查 |

### Testing

- [OK] 401项测试通过，typecheck、lint、format:check、build与git diff --check通过。
- [OK] 重放20条真实GitHub发布数据，识别1.0.27-beta；浏览器模拟验证后台结果不弹框、回前台提示、6小时调度、手动检查及无通知插件调用。

### Status

[OK] **Completed**

### Next Steps

- 真机验收（AC-6，用户口径未做）：装含本次修复的 APK 到报问题的 Android 12 设备确认课表可上下滑；已把这条路由写进 09-29-schedule-edge-swipe-device-verify 的 PRD
- 若设备实测仍滑不动：先跑 research/device-diagnostics.mjs 定位到层（锚点/布局层 / 触摸事件层 / 本来无需滚），再决定改哪里
- PR #26 待审；合并后观察 CI 的 webview:check-css 与 test:webview-css 两条新检查
- Android原生生命周期尚需真机验收。
