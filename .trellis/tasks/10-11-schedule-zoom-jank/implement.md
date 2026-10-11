# 执行计划：手机课表缩放两段式改造

> 每个里程碑结束时都必须跑完自己的**验收门**才能进入下一个。任一门的读数不达标就停在那里
> 处理，不要往下叠加改动。
>
> 回滚点：每个里程碑都对应一个可独立回退的提交边界（`P1`–`P6` 各自一个 commit）。

## 前置：门禁基线

开工前先确认工作区干净、门禁是绿的，否则后面的失败分不清是谁引入的。

```bash
git status --short                 # 期望空
pnpm test 2>&1 | tail -5
pnpm typecheck 2>&1 | tail -5
pnpm lint 2>&1 | tail -5
```

## P1 纯函数核（不动 UI）

**目标**：把变换数学、常量、落定写入计划做成可单测的纯函数；缓存模块成型。
此阶段不接线，因此对运行时**零影响**（不会引入任何回归）。

1. 新建 `app/features/schedule/zoomPreview.ts`：
   - 常量：`PREVIEW_BLUR_PX` / `SETTLE_DURATION_MS` / `SETTLE_EASING` /
     `PREVIEW_BLUR_OUT_MS` / `REDUCED_MOTION_DURATION_MS`（值见 `design.md` §8）。
   - `previewTransform(k, centerX)` → `{ translateX, scaleX }`（`tx = centerX * (1 - k)`）。
   - `tierRatio(from, to)` → `to / from`。
   - `resolveSettle({ from, to, reducedMotion })` → `{ durationMs, easing, targetScale }`。
   - `resolveCommitScrollLeft({ scrollLeft, centerX, ratio })`（复用既有公式）。
   - `prefersReducedMotion()` 判定（沿用 `useWeekSwipeGesture` 里的 `matchMedia` 写法，抽到一处）。
2. 新建 `app/features/schedule/zoomPreview.test.ts`：钉住常量数值、`tx` 换算的三个不变量
   （k=1 时 tx=0；中心点在变换前后不动；`k` 单调时 tx 单调）、`resolveSettle` 在
   `reducedMotion` 下的时长为 0、`tierRatio` 对三档组合的取值。
3. 新建 `app/features/schedule/cellLayoutCache.ts`：
   - `CellFitSnapshot` 类型；`CACHE_MAX_ENTRIES = 128`。
   - `setGeometry(key)`（变化即清空）、`record({ geometryKey, contentKey, tier }, snapshot)`、
     `lookup(key)`。
   - `resolveTierApply(snapshots, cells)` → 逐格写入计划（纯函数，输入里不含任何 DOM 读取）。
4. 新建 `app/features/schedule/cellLayoutCache.test.ts`：
   - `geometryKey` 变化后旧条目取不到；
   - 内容签名变化即 miss（不需要显式失效）；
   - 淘汰上限：写入 129 条后最早一条不可读；
   - **AC2 的核心断言**：`resolveTierApply` 对**全部命中**的输入，不调用任何 job 读取方法
     —— 用一个 `overflows()` / `readUsedWidth()` 直接 `throw` 的假 job 喂进去，测试通过即证明零读取。

**门**：`pnpm test`（新增用例全绿）+ `pnpm typecheck` + `pnpm lint`。
**回滚点**：`P1`（纯新增文件，删除即回退）。

## P2 冻结测量 + 手势期合成层预览

**目标**：AC1。手势期不再有 JS 测量、不再改网格宽度。

1. `app/features/schedule/cellLayout.ts`：
   - 加模块级闸门 `setCellLayoutSuspended(boolean)`；`enqueue` 在挂起时只入 `pending`、
     不排 rAF；恢复时排一帧刷完。
   - 抽出 `createCellLayoutJob(button: HTMLElement): CellLayoutJob | null`（按 `data-course-*`
     属性查询，与组件共用同一套元素角色）。
   - `createCellLayoutQueue` 的测试补一条：挂起期间 `fit` 不被调用、恢复后一次性收到全部去重 job。
2. `app/features/schedule/ScheduleTable.tsx`：给 stage 加 `data-schedule-zoom-stage`；
   把 stage 的 ref 交给 `useScheduleZoom`。同时给 `ScheduleTable` 上抛 `zoomStageRef`。
3. `app/features/schedule/hooks/useScheduleZoom.ts` 改写手势分支：
   - 第二指按下 → 进 `preview`：挂起测量、写 `data-schedule-zoom-preview="preview"`、
     写 stage 的 `transform` / `filter`；**不再写 `--schedule-zoom`**、**不再改 `scrollLeft`**。
   - `pointermove`：只更新 stage 的 `transform`（跟手 1:1），不读任何布局。
   - 松手 → 走 P3（本阶段先临时实现为「直接 commit」）。
   - `pointercancel` / 卸载 / 第二指序列异常 → 复位到 `idle`（清 `transform` / `filter` /
     `transition` / `data-*`，恢复测量）。
   - `setPointerCapture` 的 try/catch 与双击去抖判定保持原样。
4. `ScheduleCourseCell.tsx`：改用 `createCellLayoutJob(buttonRef.current)`。

**门（AC1）**：

```bash
pnpm build
bash .trellis/tasks/10-11-schedule-zoom-jank/research/run-zoom-perf.sh 1 <out.json> touch
```

判据：四轮手势的**手势期间**窗口 `worstLongTask < 50`、`maxFrameGap <= 50`。
基线是 200ms / 202ms（`research/baseline.json`）。

**回滚点**：`P2`。

## P3 落定动画 + 三条入口统一

**目标**：AC3 / AC4。

1. `useScheduleZoom.ts`：
   - `settle(targetTier)`：进 `settling`，写 `data-schedule-zoom-preview="settling"`、
     设 `transition`、把 `transform` 的目标值写上去（`scaleX = 目标档位 / 起始档位`）。
   - `commit(tier)`：按 `design.md` §4 的 5 步序列执行（同一帧内），然后恢复测量、
     `setZoom(tier)`。
   - 过渡结束用 `transitionend` 监听 + 一个略大于时长的 `setTimeout` 兜底（事件丢失时不能卡住）；
     两者都要在取消路径里清掉。
   - `zoomIn` / `zoomOut` / `toggleZoom` 改为 `settle(next)`；`toggleZoom` 的 400ms 去抖保留
     （它防的是 WebView 的双路径派发，与动画无关）。
   - 中途中止（新手势 / 再次点按钮）：取消当前过渡，从**当前已到达的**比例重新开始，
     不排队、不跳回。
   - `prefers-reduced-motion: reduce`：`durationMs = 0` → 直接 `commit`。
2. `zoomPreview.test.ts` 补：三条入口的 `resolveSettle` 输入不同但终态计划一致；
   `reduce` 下时长 0。

**门（AC3/AC4）**：新增一个 CDP 脚本 `research/verify-zoom-rest.mjs`（放在本任务 `research/`），
对三条入口各跑一遍，断言静止态：

- stage 与滚容器的内联 `transform` / `filter` / `transition` 为空，`computed` 为 `none`；
- `[data-schedule-grid]` 的 `data-zoom-level` == 目标档位，`min-width` == 容器宽 × 档位；
- `[data-schedule-zoom-preview]` 不存在；
- 用 `Emulation.setEmulatedMedia` 把 `prefers-reduced-motion` 设为 `reduce` 再跑一遍，终态一致。

**回滚点**：`P3`。

## P4 落定套用预计算排布

**目标**：AC2 落地到运行时；落定期不再跑实时适配。

1. `cellLayout.ts`：一批 `fitCourseCells` 跑完后，对每个 job 读回 `CellFitSnapshot`
   并写进缓存（键 = 几何 × job 携带的 `contentKey` × 当前档位）；`contentKey === ''` 的格
   （夹具/结构不完整）永不入库。
2. `ScheduleCourseCell.tsx`：给按钮加 `data-course-key`（内容签名），job 上带出
   `contentKey` 与 `applyCellSnapshot(job, snapshot)` / `readFitSnapshot(job)`。
   `contentKey` 由 `courseContentKey({ id, name, classroom, teacher, parity, note, span })` 拼成，
   **节次跨度也要进签名** —— 同一门课改上课节次时文字没变而盒子高度变了，不进签名会套用按旧高度算的排布。
3. `fitCourseCells(jobs)`：`resolveTierApply` 命中的格子**纯写**（一次测量都不做），只有 `plan.missing`
   （未命中下标）走实测，实测结果顺手入库 —— 下一次同键即命中。**绝不显示未经测量的排布**。
4. `ScheduleTable.tsx`：注册几何**读取器**（`setCellLayoutGeometryReader`），由 `fitCourseCells`
   在每批开头读一次；档位由 `useScheduleZoom.commit()` 在改宽度前**同步声明**（`setCellLayoutTier`）。

**实测修正（两处第一版设计被读数推翻，详见 `research/README.md` §9.1/§9.2）**：

- 几何**不能推**、要**按需读**：`ResizeObserver` 回调固定晚一帧，而落定后第一批查询就在下一帧，
  推送的几何键永远是上一档的；手机上 2x 的水平滚动条把容器内容盒吃掉 15px，键在档位间来回翻转，
  结果是每次换档先把刚算好的另一档查丢（实测缓存零命中）。改为批次开头现读。
- **换几何不清表**：几何键进每条条目的键（`slotKey = [几何, 内容, 档位]`），换几何只是查不到，
  LRU（`CACHE_MAX_ENTRIES = 256`）兜底。初版的「键变即清表」与上面那条叠加成恶性循环。

**门**：

- `pnpm test`（AC2 的零读取断言在 P1 已就位，这里复核它仍绿）；
- AC5 逐格适配：`run-zoom-layout-verify.sh`（本任务另写的三档驱动，原「按点击次数贴标签」的驱动会漏测
  1.5x 且标签会说谎），三个视口 × 三档 violations = 0；读数 `research/p4-ac5.json.*`；
- 落定期零测量：`run-zoom-perf.sh ... touch` 的 `research/p4-after-cache.json` 里，**每个 (几何, 档位)
  组合首访后全命中**（`a18#m0`，原始读数 `p4-hit-miss.json`），CPU profile 的 `overflows()` 自身
  由 368.26ms 降到 39.14ms（`p4-profile.json.cpuprofile` → `p4-profile-hit.json.cpuprofile`）。

**门口径修正**：原定「松手后 400ms 窗口无 ≥50ms 长任务」**不可达且不该定** —— 改宽度必然触发引擎
重排重绘，§4 的离屏克隆（零 JS）实测这一段就是 50–56ms。P4 的门是「**JS 测量归零**（命中即零格子测量）
+ 松手后的长任务降到引擎自身量级」，读数见 `research/README.md` §9.4。

**回滚点**：`P4`。

## P5 空闲预热（可选增强）

**目标**：把「首访某档位时的落定卡顿」提前到空闲窗口。

1. 新建 `app/features/schedule/hooks/useZoomTierWarmup.ts`：
   - 条件：`requestIdleCallback` 可用（不可用则整体跳过）、当前 `idle` 状态、
     距上次交互 ≥ `WARMUP_IDLE_DELAY_MS = 500`。
   - 克隆 `[data-schedule-grid]` 到离屏宿主（宽高取自滚容器与真实网格 `offsetHeight`），
     设 `--schedule-zoom: T`，按格子分片建 job、分片跑 `fitCourseCells`、读回快照写缓存。
   - 取消：`pointerdown` / `touchstart` / 滚容器 `scroll` / `wheel` / 档位变化 /
     `geometryKey` 变化 / 卸载 → 立即卸载克隆并停止后续分片。
   - 只预热非当前档位。
2. 加一个常量开关 `WARMUP_ENABLED`，默认开；关掉后一切终态不变。

**门**：预热开启与关闭两种状态下，AC3/AC4/AC5 的断言都通过；预热期间的人为交互
（脚本在预热切片中间派发 `pointerdown`）能立刻取消、且随后的捏合仍达标（AC1）。

**回滚点**：`P5`（关掉开关即等价于未实现）。

## P6 规范、守卫与门禁收口

1. 更新 `.trellis/spec/frontend/mobile-schedule-layout.md`：
   - 「Zoom Tiers and Information Levels」里的「不用 CSS `zoom`、不用 `transform: scale`」
     改为**受控例外**的准确表述：静止态不得有变换；变换只允许出现在 `preview` / `settling`
     两个显式状态、只允许 `scaleX` + `translateX`、只允许挂在 stage、必须可被内联值清空。
   - 新增「缩放的两段式（预览 → 落定）」小节：状态机、`data-schedule-zoom-preview` 观测锚点、
     落定序列的 5 步与两个顺序硬点、冻结测量的闸门位置。
   - 新增「档位排布预计算」小节：快照三字段、三层键、两个填充来源、可取消的预热。
   - 「Test Hooks」表补 `data-schedule-zoom-stage`（已存在则更新用途）与 `data-course-key`。
   - 「Common Mistakes」补：把变换写进静止态、把变换写在滚容器/网格上、落定时先写 `scrollLeft`
     再改宽度、用 `translate3d(0,0,0)` 复位、内容改了却指望缓存自己失效。
2. 更新 `app/features/schedule/scheduleSourceGuard.test.ts`：
   - 整个 schedule 目录里，`transform` / `filter` 的写入只允许出现在 `zoomPreview.ts`
     允许的模块集合内（按文件白名单断言），且不得出现在 `useWeekSwipeGesture` 以外的
     「写滚容器 transform」路径上；
   - `ScheduleTable.tsx` 里 stage 节点的 class 与 `data-schedule-zoom-stage` 同时存在；
   - `ScheduleCourseCell.tsx` 仍不含 `useIsMobile` / `cqw|cqh` / 颜色字面量（原有断言保持）；
   - 新增：`cellScale.ts` 仍是唯一的 `--cc-*` 数值真源（原有断言保持）。
3. 全量门禁：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm webview:check-css
pnpm test:android-assets
```

4. 回归复跑：
   - AC1：`run-zoom-perf.sh 1 <out.json> touch`；
   - AC5：`run-zoom-layout-verify.sh`（本任务的三档驱动：轮询 `data-zoom-level` 等落定、标签用实测档位、补 1.5x）；
   - AC6：`10-11` 任务的 `run-browser-perf.sh`（切周不得回归）。
5. 把修复后的读数写回 `research/README.md`（新增「修复后」小节），并如实列出
   **未验证范围**（本机桌面 Chrome / 软件栅格化；真机未测）。

**门（AC7）**：上面七条命令全绿 + 三条回归复跑达标 + `research/README.md` 更新完成。

## 完成判据（对照 PRD）

| 验收 | 落点 |
| --- | --- |
| AC1 | P2 门 + P6 复跑 |
| AC2 | P1 单测 + P4 浏览器复核（命中即零**格子**测量；批次开头的一次容器级读取为明确豁免，读数 `research/README.md` §9.3） |
| AC3 | P3 门 |
| AC4 | P3 门（含 `reduce` 分支） |
| AC5 | P4 门 + P6 复跑 |
| AC6 | P6 复跑 |
| AC7 | P6 门 |
