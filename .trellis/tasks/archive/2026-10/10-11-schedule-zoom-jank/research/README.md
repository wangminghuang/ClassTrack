# 研究记录：手机课表捏合缩放卡顿（2026-10-11）

本目录记录 **10-11-schedule-zoom-jank** 的基线测量、控制组与设计依据。所有读数来自本机
Chrome 155（headless，`--executable-path /usr/bin/google-chrome`）跑**生产构建** + CDP 真实触摸事件，
课程数据是归档的**合成夹具**（18 格，无任何真实用户数据）。

## 1. 被测对象与复现口径

| 项 | 值 |
| --- | --- |
| 应用资产 | `pnpm build` 产物，`python3 -m http.server` 托管 `build/client`（SPA，直接吃生产 CSS/JS） |
| 引擎 | HeadlessChrome 155，412×731 CSS px / DPR 2 |
| 种子 | 归档夹具 `09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js`，18 格、网格宽 379px |
| 手势 A | CDP `Input.dispatchTouchEvent`：`touchStart` 两指 → 40 步 `touchMove` 反向拉开/收拢 → `touchEnd` |
| 手势 B | 页内 rAF 循环，1000ms 内把 `--schedule-zoom` 从 1 线性推到 2（或反向），还原「每帧改宽度」的驱动 |
| 采集 | `requestAnimationFrame` 采帧、`PerformanceObserver(['longtask'])` 采长任务、`MutationObserver` 数课程格 `style` 写入 |
| 判据 | 手势期间（未松手窗口）的最大帧间隔与 ≥50ms 长任务；同时断言松手后吸附到预期档位 |

一键复跑：`bash research/run-zoom-perf.sh 1 <out.json> both`（第 2 参数是 CPU 降速倍率，第 4 参数 `touch`/`sweep`/`control`/`preview`）。

工具：

- `zoom-perf.mjs` —— 探针本体，四种模式（真实触摸 / 合成扫档 / 控制组 / 预览路径）。
- `profile-attrib.mjs` —— 把 `.cpuprofile` 的自身耗时按函数与来源模块聚合。
- `run-zoom-perf.sh` —— 一键起服务、灌夹具、连 CDP、跑探针。
- `verify-zoom-rest.mjs` / `run-zoom-rest.sh` —— 静止态与减少动效的验收断言（AC3 / AC4，见 §8）。

## 2. 基线：卡顿确实在手势期间

`PERF` 生产构建，rate=1，读数见 `baseline.json`：

| 手势 | 手势期间帧数 | 最大帧间隔 | p95 帧间隔 | 最重长任务 | ≥50ms 长任务数 | 课程格 style 写入 |
| --- | --- | --- | --- | --- | --- | --- |
| 捏开 1x→2x | 120 | **200ms** | 150ms | **202ms** | 35 | 101 |
| 捏拢 2x→1x | 121 | 66.7ms | 50ms | 63ms | 8 | 110 |
| 捏开 1x→2x | 123 | 166.7ms | 133.4ms | 167ms | 57 | 101 |
| 捏拢 2x→1x | 125 | **200ms** | 133.4ms | 187ms | 64 | 110 |

松手后 800ms 窗口：帧间隔 16.8ms、**零长任务**（四轮一致）。⇒ 卡顿全在**手势期间**，
松手提交本身没有问题 —— 与用户「缩放的时候会实时重新渲染文字排布，很卡」的描述一致。

合成扫档（同样的 1x→2x 跨度，1400ms 窗口）只画出 31 / 15 帧（应约 84 帧），最重长任务 180 / 189ms。

## 3. 归因：热点是 `overflows()` 的强制布局，占 67% 采样

`PROFILE=1` 跑扫档后 `profile-attrib.mjs` 的按函数自身耗时（总窗口 3089ms）：

| 函数 | 自身耗时 | 占比 |
| --- | --- | --- |
| `overflows`（`content.scrollHeight > content.clientHeight + 1`） | **2079.7ms** | **67.3%** |
| `(idle)` | 694.0ms | 22.5% |
| `(program)` | 227.5ms | 7.4% |
| `readUsedWidth` | 9.3ms | 0.3% |
| `getClientRects` | 8.2ms | 0.3% |

机理：`fitCourseCells`（`cellLayout.ts`）每个阶段都是「先写 DOM、再读 `scrollHeight`」——
首轮 1 次 + 丢弃行最多 3 轮 + 兜底阶梯最多 5 轮 = **每轮适配最多 9N 次强制布局**（18 格 → 162 次/帧）。
每次读都会把「写 display / 写 `--cc-scale`」的失效状态同步刷成一次整表重排。

这正是 `10-11-schedule-week-swipe-jank` 修过的同一类热点：那次修的是**松手切周**（新课程格集中挂载），
捏合路径没被覆盖；本次改写的是手势期每帧都跑同一套适配。

## 4. 控制组：把「JS 测量」与「引擎自身换行」分开

方法：把 `[data-schedule-grid]` 克隆到一个离屏 `visibility:hidden` 宿主里（克隆没有任何
`ResizeObserver`/测量任务），再对它做同样的 `--schedule-zoom` 扫档；可选叠加 `filter: blur(Npx)`。
只用离屏克隆，不碰真实网格，用完即删。

| 场景（1400ms 窗口，1x→2x） | 帧数 | 最大帧间隔 | 最重长任务 | ≥50ms 长任务数 |
| --- | --- | --- | --- | --- |
| 真实路径（含 JS 测量） | 31 | 200ms | 189ms | 多 |
| 离屏克隆 · blur 0（零 JS 测量） | 51 | 66.6ms | 56ms | 6 |
| 离屏克隆 · blur 2px | 51 | 66.6ms | 63ms | 3 |
| 离屏克隆 · blur 4px | 53 | 50ms | 51ms | 2 |

结论一：**冻结 JS 测量约拿回 3 倍**（最重长任务 189ms → 56ms）。
结论二：**模糊滤镜本身在噪声内**（0/2/4px 三档读数不可区分）——「动画期间加模糊」不额外付费。
结论三：即使 JS 归零，「真实改宽度 + 引擎重排」在这套环境里也只有 **~36fps（51/1400ms）**，
到不了顺滑。⇒ 只靠「冻结测量」不够，需要一条不经重排的路径。

## 5. 预览路径：合成层 transform 是唯一满帧方案

同一个离屏克隆，改的是 `transform: translateX(xc·(1−k)) scaleX(k)`（把捏合中心钉在原地）
而不是宽度；`translate`/`scale` 都是合成器属性，不触发布局。

| 场景（1400ms 窗口，1x→2x） | 帧数 | 最大帧间隔 | 最重长任务 | ≥50ms 长任务数 |
| --- | --- | --- | --- | --- |
| transform 预览（无模糊） | **84 = 满帧** | **16.8ms** | **0** | **0** |
| transform 预览 + 3px 模糊 | **84 = 满帧** | **16.8ms** | **0** | **0** |

⇒ 设计结论：**手势期走 transform 预览（零重排），松手后把真实排布一次性落定**。
`scaleX` 只拉伸横向，与「缩放只改列宽」的语义同构（行高不变）；文字形变的失真由动画期间的
模糊掩盖，落定帧清晰。

## 6. 探针的已知局限

- LoAF（`long-animation-frame`）条目的 `styleAndLayoutDuration` 在本机取不到（序列化后为
  `undefined` → JSON 成 `null`），因此「样式+布局时长」这一列不可用；JS 归属只能靠
  `.cpuprofile` 的函数自身耗时（§3）。
- `visibility: hidden` 的克隆不参与绘制，因此控制组读数**只含样式重算与布局**、不含栅格化。
  这不影响 §4 的结论方向（它给出的是「引擎重排」的**下界**），但意味着真机 GPU 上的绝对帧率
  会优于本机数字。
- 本机是桌面 Chrome + 软件栅格化，**不能替代真机结论**。本次结论都写成同环境内的相对比较
  （同夹具、同视口、同引擎、同 CPU 速率）。

## 7. 实现后复测：P2 里程碑（手势期冻结测量 + 合成层预览）

`PERF` 生产构建，rate=1，读数见 `p2-after-preview.json`（同夹具、同手势 A、同窗口口径）。

| 手势 | 手势期间帧数 | 最大帧间隔 | 最重长任务 | ≥50ms 长任务数 |
| --- | --- | --- | --- | --- |
| 捏开 1x→2x（基线 120 帧 / 200ms / 202ms / 35 个） | **81** | **16.8ms** | **0** | **0** |
| 捏拢 2x→1x（基线 121 帧 / 66.7ms / 63ms / 8 个） | **81** | **16.8ms** | **0** | **0** |
| 捏开 1x→2x（第二轮） | 81 | 16.8ms | 0 | 0 |
| 捏拢 2x→1x（第二轮） | 81 | 16.8ms | 0 | 0 |

四轮的手势期间读数完全一致（81 帧 / 16.8ms / 零长任务），与 §5 里合成层预览的预期吻合，AC1 达成；
四轮也都断言了松手后吸附到预期档位，因此这条路径的功能没有为了性能让位。

**代价被搬到了落定那一帧**：松手后 600ms 窗口里出现一次 55–154ms 的长任务（基线同窗口是零长任务）。
原因是手势期不再改宽度，落定帧于是同时承担「改宽度 + 18 格各跑一遍 `fitCourseCells`」。
这正是 P4（落定套用预计算排布）要消灭的那一下，读数留在这里作为 P3/P4 的对照基线。

## 8. 实现后复测：P3 里程碑（落定过渡 + 三入口）

静止态与降级的判据（AC3 / AC4）由 `verify-zoom-rest.mjs` 断言，一键复跑：

```bash
bash .trellis/tasks/10-11-schedule-zoom-jank/research/run-zoom-rest.sh /tmp/claude/zoom-rest.json
```

读数见 `zoom-rest.json`。12 项静止态检查全过（正常动效 9 项 + 减少动效 3 项）：

| 条目 | 断言要点 |
| --- | --- |
| 双指捏合 1x→1.5x | 手势期 `preview` + 有内联 `transform` + `--schedule-zoom` 仍为 1；松手瞬间 `settling` 且宽度**仍**冻结在起始档位 |
| 双指捏合 1x→2x | 预览比例已等于目标比例 ⇒ 无过渡可播，松手同步落定（`settling` 不出现），但模糊仍延后一个绘制帧才淡出 |
| 双指捏合（真实触摸，CDP） | 端到端终态：tier=2、网格宽 758px、`scrollLeft=198` |
| `+` / `−` 连点四次 | 1 → 1.5 → 2 → 1.5 → 1，每次点击都同步进入 `settling` |
| 双击 | 1 ↔ 2，同步进入 `settling` |
| reduce × 3 | 捏合 / 按钮 / 双击都「点下去就落定」（同步读到 `settling` 为 null），且手势期全程无模糊 |

每个用例的静止态判据都是同一组：stage 与滚容器的内联 `transform` / `filter` / `transition` 全空、
stage 计算 `transform` 与 `filter` 都是 `none`、`data-schedule-zoom-preview` 不存在、
`data-zoom-level` 与 `--schedule-zoom` 都等于目标档位、网格实际宽度等于「档位 × 滚容器宽度」
（误差 ≤1px）、控件读数与档位一致。

> 脚本里两处刻意的做法：相位读取用**同步派发**的 `PointerEvent`（真实触摸必须经过 CDP 往返，
> 读到的是往返之后的状态，无法稳定断言「过渡正在播」）；`resetToBase()` 用 `Page.reload`
> 复位（缩放值不持久化，reload 即回 1x）。真实触摸路径另有一条端到端用例只验终态。

## 9. 实现后复测：P4 里程碑（落定期零测量的排布缓存）

P4 的目标是把 §7 那一下「落定帧同时改宽度 + 18 格实测」拆开：宽度照改，排布改为**查预计算表**。
结论是做到了，但**过程里发现两处设计错解**，都靠读数抓出来 —— 这一节按「怎么发现的 → 改成什么 → 复测数字」记录。

### 9.1 先是量不到命中：几何键被推送晚了一帧

缓存键 = 几何 × 内容 × 档位（`cellLayoutCache.ts` 的 `geometryKeyOf` + `courseContentKey` + `tier`）。
第一版几何由 `ScheduleTable` 用 `ResizeObserver` **推**进缓存（回调里 `setCacheGeometry`）。复测
（`p4-after-cache.json` 初版 + `p4-profile.json(.cpuprofile)`）显示缓存没生效：四轮捏合的松手后长任务
是 `[59] / [66] / [] / [102]`，CPU profile 里 `overflows()` **自身 368.26ms，全场第 2**（仅次于 idle 7948ms）。

原因是 `ResizeObserver` 回调固定在渲染步骤最后跑，**必然晚一帧**；而落定后第一批查询就在下一帧、
且落定帧的宽度是同步写下去的 ⇒ 查询用的几何键还是上一档的。手机上尤其致命：1x 时容器内容盒高
548px、2x 时出现水平滚动条后被征用掉 15px 变成 533px，几何键在档位间来回翻转，于是**每次换档先
把上一档刚算好的条目查丢**。

改成**按需读**：`ScheduleTable` 只注册读取器（`setCellLayoutGeometryReader`），
`fitCourseCells()` 在每批开头读一次（`currentCellLayoutGeometry()`）。此时落定宽度已写好，
一次读取连滚动条状态一起算进布局；批次内只读一次也顺带免掉「套用路径每格写一次读一次」的强制布局。

### 9.2 再是「键变即清表」反噬：换几何键不该清空

初版还有一条「几何键变化 ⇒ 整表丢弃」。它和 9.1 的 15px 差异叠加后变成恶性循环：每次换档都先把
刚算好的另一档条目扔掉。改成**几何键进每条条目的键**（`slotKey = [几何, 内容, 档位]`），换几何只是查不到，
LRU（`CACHE_MAX_ENTRIES = 256`）兜底淘汰。

### 9.3 命中是零测量：`a18#m0`

命中与否在读数里不可能含糊 —— 临时给 `fitCourseCells` 加了一行探针，把「几何 + 档位 + 已套用 +
未命中」记进 `globalThis`，跑完即撤（原始读数留档 `p4-hit-miss.json`，`a`=已套用、`m`=未命中）：

```
pinch-out-1x→2x | 379|548|even|mobile#tier1#a0#m18   379|548|even|mobile#tier1#a18#m0
                | 379|548|even|mobile#tier1#a18#m0   379|533|even|mobile#tier2#a0#m18
pinch-in-2x→1x  | … 379|548|even|mobile#tier1#a18#m0
pinch-out-1x→2x | … 379|533|even|mobile#tier2#a18#m0
pinch-in-2x→1x  | … 379|548|even|mobile#tier1#a18#m0
```

读法：**每个 (几何, 档位) 组合只有第一次访问是 `a0#m18`（格子测量），之后每次都是 `a18#m0`（全命中、
一次格子测量都不做）**。四轮捏合里第 1 轮冷启 2x 档（`379|533|tier2`）测了一次，第 2/3/4 轮全部命中 ——
AC2 的「命中时零测量」在浏览器里成立（单测那一侧另有 `readProofCell` 用「读就抛」把这条钉死）。

### 9.4 松手后剩下的那一下不是我们的

复测 `p4-after-cache.json`：四轮手势期仍是 **零长任务、最大帧间隔 16.8–33.4ms**（AC1 不退化）；
松手后 600ms 窗口的长任务是 `[83,51] / [76] / [64] / []`。

这一段**不比控制组更贵**：§4 的离屏克隆（挂到 DOM 外、零 JS、零 ResizeObserver、只改宽度）实测长任务
`[50,55,53,52,52,56]ms`、最大帧间隔 66.6ms —— 也就是说「把 18 格网格从 1x 宽度重排重绘到 2x」这件事
本身就要 50–56ms。P4 把 **JS 测量**拿掉后，剩下的就是这一份引擎开销（外加套用 18 格快照的写入）。

CPU profile 的前后对照最直接（同一脚本、同夹具、同四轮手势）：

| 函数 | 修复前（缓存未命中） | 修复后（缓存命中） |
| --- | --- | --- |
| `overflows()` 自身 | **368.26ms**（全场第 2） | **39.14ms**（−89%，只剩第 1 轮冷启 2x 那一次） |
| `schedule-*.js` 模块自身 | 614.51ms | 369.49ms（−40%） |
| 非 idle 第一名 | `overflows()` | React 内部 `_`（套用写入） |

所以 P4 的门禁口径定为：**「命中缓存的落定帧做零格子测量」（`a18#m0` + AC2 单测），松手后的长任务降到
引擎自身重排量级（对照 §4 控制组 50–56ms）**，而不是「归零」—— 归零需要引擎不重排，那是不可能的。
第 1 轮那次冷启测量（`39ms`）留给 P5 的空闲预热去消，消掉后 `overflows()` 应再降一个量级。

### 9.5 三档逐格回归（AC5）：`run-zoom-layout-verify.sh`

P4 改的是套用路径（缓存命中时不再实测），所以必须重新证明「算出来的排布和量出来的排布一样」。
复用 `10-11-schedule-week-swipe-jank` 的逐格断言，但**另写了一份驱动**（`verify-zoom-layout.mjs`），
两点必须改：

1. 原脚本按「点了几次 ± 」给标签贴 1x/2x，点击间隔 200ms 撞上 180ms 的落定过渡时会被状态机吃掉一次，
   报告里的档位名不副实（本次实测就撞上过：标签写 1x、`data-zoom-level` 实际是 1.5）。新驱动**轮询
   `data-zoom-level` 等落定**，标签用实测档位。
2. 补上第三档 1.5x —— 三档各一套快照，漏一档等于漏测一条缓存路径。

```bash
bash .trellis/tasks/10-11-schedule-zoom-jank/research/run-zoom-layout-verify.sh <out.json>
```

读数 `p4-ac5.json.{360x794,412x731,1440x900}`，**violations 全 0**：

| 视口 | 入口 | 档位 | 检查数 |
| --- | --- | --- | --- |
| 360×794 DPR2 | ± 按钮 | 1x(compact) / 1.5x(standard) / 2x(full) | 6（三档 × 本周/跨周） |
| 412×731 DPR2 | ± 按钮 | 1x(compact) / 1.5x(standard) / 2x(full) | 6 |
| 1440×900 DPR1 | 双击 | 1x(compact) / 2x(full) | 4 |

桌面这一档要说清楚：`data-schedule-zoom-control` 只在 `isMobile` 下渲染，桌面只能双击切换
`toggleZoom`（1x ↔ 2x，覆盖不到 1.5x，报告 `summary.skipped` 里写明）；而且桌面的网格有 **760px 固定
下限**（实测 1x/2x 的 `min-width` 都是 `760px`、网格宽都是 1142px），**换档对桌面宽度是空操作**，
所以桌面这两档只是「不违约」的回归，真正的三档覆盖在手机视口。

## 10. 实现后复测：P5 里程碑（空闲预热两个非当前档位）

P4 之后「切档」已经零测量，但**首次**切到某个档位仍要实测一次（§9.3 里第 1 轮的 `a0#m18`，
约 39ms）。P5 把这一次提前到用户看不见的空闲窗口：离屏克隆一份网格、单独给它写上
`--schedule-zoom: T`，按格分片（每片 4 格）在 `requestIdleCallback` 里量完并入库，量完即弃。
任何交互（`pointerdown` / `wheel` / `touchstart` / 滚动）立刻取消并卸载克隆。

### 10.1 预热逼着几何键改成「档位无关」（这次是正面修正）

原来的几何键是「滚容器内容盒 × 列模板 × 断点」，其中内容盒高度会随水平滚动条在档位间翻转
（548 ↔ 533，见 §9.1）。这在 P4 只表现为「条目被切碎」，到 P5 就变成硬伤：**预热必须提前算出
「真实路径在那个档位下会读到的键」**，而容器内容盒高度正是它算不出来的那一位 —— 克隆宿主的盒子
再准，也猜不到滚动条会怎么征用容器。

于是几何键改成 **「滚容器内容宽 × 网格自身高度 × 列模板 × 断点」**：

- 网格高被「12 行 × 62px = 780px」这个地板钳住，**三档同一个值**（`research/p4-after-cache.json`：
  1x 与 2x 的 `grid` 读数都是 `[379,780]` / `[758,780]`，高度都是 780）；
- 网格宽该随档位变，而那一维由档位键负责，所以这里只留**容器内容宽**（三档都是 379px）；
- 列模板取**内联 style 里那个字符串**（`gridTemplateColumns`），不能取 `getComputedStyle` 的结果 ——
  后者已经把档位算进像素值（1x 是 `"32px 49.56px …"`、2x 是 `"32px 103.7px …"`），又会把键变回随档位翻转。

实测（`p5-hit-miss.json`）：三档下的几何键统一成 `379|780|even|mobile`，条目不再被档位切碎；
`CACHE_MAX_ENTRIES` 也随之从 256 降到 128（1 套几何 × 18 格 × 3 档 = 54，留一倍余量）。

### 10.2 克隆宿主的尺寸不是随便定的

几何键既然由「容器内容宽 × 网格自身高度」构成，宿主就要让克隆的这两项与真实网格逐项相同：

- **宽 = 滚容器 `clientWidth`** ⇒ 克隆网格宽 = `档位 × 这一项`，正是真实档位下的宽度；
- **高 = 真实网格 `offsetHeight`** ⇒ 克隆网格的 `min-h-full` 落在同一个高度上，行高一致
  （同时满足两种情形：网格被 12 行地板撑住时它是 780；容器比 780 还高时它等于容器内容高，而宿主已经等于它）。

两项对上，克隆格子的盒子就与真实档位下的盒子逐像素一致，预热记下的快照才会被真实路径查到；
万一哪天对不上，结果也只是「预热白做」（键不同、查不到），不会让用户看到没算过的排布。

两个实现细节：

- 预热的每一片都通过 `withCellLayoutScope({ tier, readGeometry }, () => fitCourseCells(jobs))`
  临时把「档位」与「几何读取器」换成克隆的那一套，跑完还原 —— 真实路径的两个来源仍由
  `commit` 与 `ScheduleTable` 各自声明，不必把它们透传到底。
- 克隆里的格子会**去掉 `data-course-cell`**（枚举改用 `data-course-key`）：验收脚本按
  `[data-course-cell]` 数格子、逐格断言排布，克隆混进全局查询就是 36 格。预热对任何读数都应当「不存在」。

### 10.3 读数

一键复跑（`PREWAIT_MS` 是让预热跑完的等待窗口，默认 0）：

```bash
PREWAIT_MS=3000 bash .trellis/tasks/10-11-schedule-zoom-jank/research/run-zoom-perf.sh 1 <out.json> touch
```

`p5-hit-miss.json` 里的每次 `fitCourseCells`（`a`=已套用、`m`=未命中）：

```
tier1   #a0#m18            ← 首屏真实适配（唯一一次「必须当场量」的）
tier1   #a18#m0  ×2        ← 内容/字体变化后的重适配，命中
tier1.5 #a0#m4 ×4, #a0#m2  ← 预热（空闲分片，18 格 = 4+4+4+4+2）
tier2   #a0#m4 ×4, #a0#m2  ← 预热
tier2   #a18#m0            ← 用户第一次捏到 2x：命中，零测量（P4 时这里是 a0#m18）
tier1   #a18#m0            ← 捏回 1x：命中
tier1.5 #a4#m0 ×4, #a2#m0  ← 档位变化触发的第二轮预热：全命中（纯写，等于不花钱）
tier2   #a4#m0 ×4, #a2#m0  ← 同上
```

落定窗口（`p5-after-warmup.json`，与 §7 / §9.4 同口径）：

| 轮次 | 手势期帧数/最大帧间隔/长任务 | 松手后 600ms 长任务 | 松手后最大帧间隔 |
| --- | --- | --- | --- |
| 捏开 1x→2x | 81 / 16.8ms / **0** | **0** | 33.3ms |
| 捏拢 2x→1x | 81 / 16.8ms / **0** | **0** | 33.4ms |
| 捏开 1x→2x（二轮） | 81 / 16.8ms / **0** | 52ms | 33.4ms |
| 捏拢 2x→1x（二轮） | 81 / 16.8ms / **0** | **0** | 33.3ms |
| 对照：P2（无缓存） | 81 / 16.8ms / 0 | 55–154ms | 50–167ms |
| 对照：P4（有缓存、首访实测） | 81 / 16.8–33.4ms / 0 | 64–83ms | 50–66.7ms |

四轮里三轮松手后**连一个 ≥50ms 的长任务都没有**，剩下那一次 52ms 正是 §4 控制组给出的引擎自重排
量级（50–56ms，零 JS 的离屏克隆也是这个数）。也就是说：落定帧现在只剩「浏览器把网格摆成新宽度」
这一件不可避免的事。

### 10.4 预热的正确性回归

预热是「另一条路径算出来的排布」，所以必须重新跑一遍逐格断言与静止态断言（两者都比 P4 更严：
预热算错的排布会直接被 AC5 的逐格断言抓住）：

- 三档逐格回归：`p5-ac5.json.{360x794,412x731,1440x900}`，**violations 全 0**；
- 静止态：`p5-zoom-rest.json`，**12 项全过**（含 reduce 三项）。

### 10.5 已知局限

- 预热只在「用户 500ms 内没碰课表且之后有空闲帧」时才能跑完。打开就立刻捏合的用户仍会走一次
  实测 —— 这是刻意的取舍：抢在用户前面算完是赚，抢用户的时间是亏。
- 本机是桌面 Chrome + 软件栅格化（§6），真机数字未测；上面全部结论都是同环境内的相对比较。

## 11. 收口：规范、源码守卫与全量复跑（P6）

P6 不动运行时代码，只做三件事：把这次改造写进规范、把它变成会失败的测试、用同一套读数复跑一遍。

### 11.1 规范（`.trellis/spec/frontend/mobile-schedule-layout.md`）

- 「Zoom Tiers and Information Levels」里原来那句「**不引入任何等比缩放**（不用 CSS `zoom`、不用
  `transform: scale`）」改成「档位切换本身只改列宽」，等比缩放的禁令下移到新的受控例外小节。
- 新增「**缩放的两段式：手势期预览 → 落定**」：状态机、预览的换算与挂载点、落定的写入顺序
  （档位 → 宽度 → `scrollLeft` → 清变换）、**受控例外**的准确边界（只允许 `preview` / `settling`
  两个相位、只允许 `scaleX` + `translateX`、只允许挂 stage、静止态必须清空）、观测锚点。
- 新增「**档位排布预计算**」：三层键的构成与两条容易写错的取法（宽取滚容器、高取网格；列模板取
  内联 style）、内容改键即变、两个填充来源、预热可取消。
- Test Hooks 表新增 4 行：`data-schedule-zoom-stage`（并说明 `transform`/`filter` 只许写在这一层）、
  `data-course-key`、`data-schedule-zoom-preview`、`data-schedule-zoom-warmup`。
- Common Mistakes 新增 7 条（全是这次踩过或差点踩的）：手势里实时改宽度、变换挂错层、落定顺序、
  拿 `getComputedStyle` 做几何键、「几何变了就清表」、`ResizeObserver` 推送几何、预热克隆污染读数。

### 11.2 源码守卫（`app/features/schedule/scheduleSourceGuard.test.ts`）

新增一个 `describe('缩放预览的受控例外边界')`，8 条断言（守卫从 8 条到 16 条）：

| 断言 | 防的是什么 |
| --- | --- |
| 只有白名单文件写内联 `transform` / `filter` | 别处偷偷加变换（`useScheduleZoom` 与既有横滑 `useWeekSwipeGesture` 之外一律不许） |
| 白名单本身没写错 | 防止路径改名后守卫静默空跑 |
| 缩放预览的每一次变换写入都以 `stage` 为目标 | 目标错成网格/滚容器就会污染 `scrollWidth` 与边缘阻尼 |
| 预览不碰网格与滚容器的内联样式（含表组件里不许出现 `.style.transform`） | 同上，从表组件侧再堵一次 |
| 不用 CSS `zoom`、不用 `transform: scale`、不用 `scale-<n>` 类 | 「2x 退化成放大镜」的两条老禁令 |
| `blur(<数字>` 只许出现在 `zoomPreview.ts` | 模糊半径单一真源 |
| `.style.transition` 里不许写 `\d+ms` 字面量，且必须从 `zoomPreview` 引常量 | 时长单一真源 |
| stage 节点同时带 `data-schedule-swipe-stage` / `data-schedule-zoom-stage`、裁剪层 `overflow-hidden`、`ref={zoomStageRef}` | 变换靠裁剪层兜住预览多出来的部分 |

### 11.3 复跑（全部读数在本次提交里）

| 项 | 命令 | 读数 |
| --- | --- | --- |
| AC1 + AC6（手势期不带动任何真实盒子） | `PREWAIT_MS=3000 run-zoom-perf.sh 1 p6-after-spec.json touch` | 四轮手势期零长任务 / 最大帧间隔 16.8ms；脚本内新增断言全过：手势期 `gridWidth`、`scrollWidth`、`zoomLevel` 与手势前逐项相同，stage 上是 `scaleX` + `blur(3px)` + `preview` 相位，预热宿主已卸载 |
| AC6（切周回归） | `PERF_ASSERT=1 run-browser-perf.sh 1 p6-week-switch.json` | `worstFrameGap 33.4ms` / `worstLongTask 0`（脚本自带断言：每次手势恰好切一周、终态 `idle`、`transform`/`opacity` 清空） |
| AC5（三档逐格） | `run-zoom-layout-verify.sh p6-ac5.json` | 360×794 / 412×731 / 1440×900 三视口 **violations 全 0**（与 P5 那次同代码同结果） |
| AC3/AC4（静止态） | `run-zoom-rest.sh p6-zoom-rest.json` | **12 项全过** |
| AC7（七项门禁） | `pnpm test` / `typecheck` / `lint` / `format:check` / `build` / `webview:check-css` / `test:android-assets` | **471 tests / 50 files** 全绿，其余六项全绿 |

### 11.4 未验证范围（如实列出）

- **真机未测**：上面所有数字都来自本机桌面 Chrome（软件栅格化、DPR 2 的模拟视口）。合成层变换的
  收益在真机上只会更大（这块本来就是 GPU 合成），但**没有真机读数**，别把它当已验证。
- **窄屏 / 超长内容**：夹具是 18 格（含 7 行跨度的长课名）。格数更多、内容更长的课表，缓存条目数与
  预热切片数都会涨（`CACHE_MAX_ENTRIES = 128` 是「1 套几何 × 18 格 × 3 档」的两倍余量，不是按别的
  课表算的）。
- **`reduce` 分支**只验了「过渡时长为 0、不加模糊」与终态，没有验「用户中途打开系统 reduce」。
- **预热与横滑的交叉**：预热会被横滑取消（脚本里验了 `warmupHost=false`），但没有验「预热进行到一半
  时用户横滑」的完整时序。
