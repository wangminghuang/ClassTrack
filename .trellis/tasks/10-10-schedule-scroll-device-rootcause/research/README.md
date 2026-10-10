# 研究记录：手机端课表无法上下滑动（2026-10-10 模拟器取证）

本目录记录 **10-10-schedule-scroll-device-rootcause** 在规划阶段做过的全部实验、读数与结论边界。
所有读数都来自本机 Android 模拟器 + CDP（Chrome DevTools Protocol）真实触摸事件，**不含**任何设备标识或环境凭据。

## 1. 被测对象

| 项 | 值 |
| --- | --- |
| 应用资产 | `android-beta-29`（`ClassTrack-beta-1.0.29-beta.apk`）的 `assets/public/**`，与本地构建字节一致 |
| 视口 | 1080×1920 @ 420dpi ⇒ **411×731 CSS px**（dpr 2.625） |
| 种子数据 | 归档夹具 `09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js`（`currentWeek=3`、`maxWeek=16`、18 个课程格），经 `make-seed.mjs` 生成 `localStorage` 写入脚本 |
| 课表网格最小高度 | `2.25rem + repeat(12, minmax(3.875rem, 1fr))` ⇒ 约 **780 px**（必然纵向溢出 731 px 视口） |
| 可调试性 | release 包 `webContentsDebuggingEnabled=false`，故用「原生 release + `assets/capacitor.config.json` 打开调试开关」的忠实可调试包；另用「debug 壳 + beta 资产」包做对照，两者 web 资产字节一致 |

## 2. 实验清单

| # | 实验 | 条件 | 观测 | 结论 | 数据 |
| --- | --- | --- | --- | --- | --- |
| E1 | 引擎带：API 31 出厂镜像 | WebView **91** | 页面空白：`appViewport: null`、`courseCells: 0`、`supportsDvh: false`，viewport 412×660 | 低于规范基线（Chrome 111+）；产物含 `@layer`(99+) / `oklch()`(111+) ⇒ **静默失效**，不能作为对照引擎 | 见 §4 说明 |
| E2 | 引擎带：API 32 镜像（r08） | WebView **120** | `supportsDvh: true`，正常渲染（该轮种子注入失败，页面停在导入对话框，`hasScrollContainer:false`） | 该镜像已不是「无 dvh」带；渲染正常 | `evidence/scroll-api32-chrome120/` |
| E3 | 引擎带：API 37.1 镜像 | WebView **149** | `clientH 501 / scrollH 780 / maxScrollTop 279`；程序化滚动 278.86 ✓；CDP 单指拖动 0 → 278.86 ✓；`maxScrollLeft 0` | 现代引擎上单指纵向滚动正常 ⇒ **复现不到用户症状** | `evidence/scroll-api371-chrome149/` |
| E4 | 多点手势矩阵 | WebView 149，已灌种子 | m1 单指 0→278.86 ✓；**m2 双指平行竖直 0→0 ✗**；**m3 中途落第二指 0→0 ✗**（且 `--schedule-zoom` 1→2）；m4 擦碰第二点后继续拖 0→0 ✗；m6 缩放后单指 0→278.86 ✓ | 多触点竖直拖动被整体拒绝；缩放分支被触发 | `evidence/touch-matrix-chrome149/` |
| E5 | 对照容器（无应用 JS） | 149，向 `document.body` 注入普通 `div`（在 React 树之外） | `touch-action:auto`：单指 `top 182` ✓、**双指 `top 186` ✓**；`touch-action:pan-x pan-y`：单指 `top 192` ✓、**双指 `top 0` ✗** | **是 `touch-action` 值本身**让引擎拒绝多触点竖直拖动，不是应用 JS | `evidence/touchaction-swap-chrome149/cdp.log`（c1–c4 段） |
| E6 | 运行时替换应用容器的 `touch-action` | 149，应用自己的 `[data-schedule-scroll]` | 现状 `pan-x pan-y`：双指 0→0 ✗；改 `manipulation`：0→**278.86** ✓；改 `auto`：0→**278.86** ✓；恢复后单指 0→278.86 ✓ | 修复方向可行且不动单指行为 | `evidence/touchaction-swap-chrome149/t0..t3.json` |
| E7 | 交付链路/缓存 | 149，`adb install -r` 覆盖升级 | 原生 WebView 不注册 SW（`registrations: []`、`cacheKeys: []`、`swController: null`）；运行时 CSS = `root-D5a9k11K.css`，sha256 `418f3ab4…`，与包内/本地构建一致 | **已发布包确实运行了修好的 CSS** ⇒ 高度锚点修复不是（全部）成因 | 见 §4 说明 |
| E8 | 产物兼容性核对 | `build/client` 与包内产物 | `oklch(` 出现 **95** 次，构建未配置降级目标；`.h-svh`/`.min-h-svh` 无 `100vh` 兜底；`html,body` 已有兜底 + `@supports` 升级块 | 低于 Chrome 111 的引擎颜色会明显坏掉；`.h-svh`/`.min-h-svh` 仍未兜底 | `prd.md` §已确认事实 4 |


## 2.1 根因轮（用户同一个包上复现，2026-10-10）

| # | 实验 | 条件 | 观测 | 结论 | 数据 |
| --- | --- | --- | --- | --- | --- |
| R1 | **在用户包上复现** | API 32（WebView **120.0.6099.193**）装 `android-beta-29`（无诊断代码） | `[data-schedule-scroll]` `clientH 510 / scrollH 510 / maxScrollTop 0`，而 `[data-schedule-grid]` `clientH 510 / scrollH 780`（13 行 = 36 + 62×12）；程序化 `scrollTop=9999` → **0**；系统级 `input swipe` → **0** | 网格行溢出自身盒子（780 > 510）却**没进祖先滚动容器的 `scrollHeight`** ⇒ 单指也滚不动 | `evidence/a32-chrome120-rootcause-fix/01-before-fix-sizes.json` |
| R2 | 同页运行期注入候选样式 | 同上，`[data-schedule-grid]{height:auto;min-height:100%}` | scroller `510 / 780 / max 270`；grid `clientH 780`；系统级 `input swipe` → **270 = max** ✓ | 机制确认，修复方向可行 | `evidence/a32-chrome120-rootcause-fix/02..03` |
| R3 | 修复真包（`min-h-full` + 浮层）在 Chrome 120 | `android-beta-30` 资产 | `scroller 510/780/max 270`；系统级上滑 → **270**；浮层自判 **`SCROLL_OK`** | 修复在失败引擎上成立 | `evidence/a32-chrome120-rootcause-fix/04..05` |
| R4 | 高视口无回归 | 视口 1103（容器 921 > 最小内容 780） | 修复前后逐项相同：grid `clientH 921 == scroller.clientH 921`、行高 73.744px | 不改变「有富余高度」时的行为 | 见 `implement.md` P5 |
| R5 | 双引擎手势回归 | Chrome 120 与 149，起点避开浮层（`y=400`） | 单指 `0 → max`；缩放 `1 → 2`；缩放后单指 `0 → max`；边缘横滑 `3 → 2`；**开关关闭**时周次不变且单指仍 `0 → max`；双指竖直两引擎仍 `0 → 0`（已知独立缺陷） | 零回归；多触点缺陷与本修复互不影响 | `evidence/gesture-matrix-dual-engine.md` + `a32-…`/`m37-…` 两个目录 |

## 3. 判定含义（供根因收敛用）

- **用户口径「单指也滑不动」** ⇒ E4–E6 的多触点缺陷**不是**其症状根因（单指在任何 `touch-action` 下都能滚）。
- **E7 + E8** ⇒ 若用户设备 WebView < 111，则不仅高度链、连配色都会坏（用户未报配色异常）
  ⇒ 其 WebView 大概率 ≥ 111 ⇒ `dvh`/`svh` 可用 ⇒ 高度链不会因视口单位失效。
- 于是转向「取设备侧读数」；而真正结案靠的是 §2.1 R1：**在用户同一个包上复现**（而不是推断或等价复现）。
  用户读数因此降级为**复核**材料，不再是结案前提。

## 4. 未落库/不可复用的读数（如需复核需重跑）

- E1（WebView 91 整页空白）与 E7（SW/缓存核对）当时输出被后续 run 覆盖；数值已如实记录在
  `prd.md`「已确认事实」段。重跑口径：API 31 google_apis 镜像 + 本文 §1 的可调试包 + 同一套探针脚本。
- E2 那一轮的种子注入失败（`seed-write: undefined`），因此只有「渲染与 `supportsDvh`」结论，没有滚动读数；
  需要时以 `WIPE=1` 重跑并确认种子写入成功。

## 5. 复现要点（不写入本机路径）

1. 建 AVD：复制同版本镜像的只读 AVD `config.ini` 后改写 `AvdId` / `avd.ini.displayname` /
   `image.sysdir.1` / `target`（系统镜像缺 `package.xml` 时 `avdmanager create avd` 不可用），并写同名 `.ini`。
2. 启动：`emulator -avd <AVD> -no-window -no-audio -no-boot-anim -no-snapshot [-wipe-data] -gpu swiftshader_indirect -no-metrics`；
   宿主内存紧张时降到 `-memory 1536 -cores 3`（2048 曾出现模拟器被静默杀掉）。
3. 装包并起 WebView：`adb install -r <apk>` → `am start -n com.classtrack.app/.MainActivity` →
   `adb forward tcp:9222 localabstract:$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote[^ ]*' | head -1)`。
4. 取数：CDP `Runtime.evaluate` 读布局链与事件计数；`Input.dispatchTouchEvent` 造真实触摸帧序列
   （`touchStart/touchMove/touchEnd`，多指即多个 point）；`adb shell input swipe` 做系统级真实触摸对照。
5. 注意：`pkill -f '<pattern>'` 会匹配到调用者自己的命令行，务必写成 `pkill -f '[q]emu…'` 之类避免自杀。
6. **拖动起点要避开诊断浮层**：浮层固定在底部（本任务最终收紧到 34vh）。自动化手势若从浮层覆盖区起步，
   事件落在浮层上、课表纹丝不动，会被误判成「修复无效」——本任务在这上面白跑过一轮。
7. **别用 `| head -N` 截断脚本输出**：`head` 提前退出会让被管道写入的脚本收到 SIGPIPE 而中断，
   表现为「后面的步骤静默不执行」（日志里只剩前 N 行）。
8. **从整段脚本里摘片段复用时要补全局部变量**：`set -u` 下缺失 `D=`、`ADB=` 之类的定义会直接 `unbound variable` 中止；
   摘出来的片段要在开头自带这些定义。
