# 设计：手机课表缩放的两段式（合成层预览 → 一次性落定）

## 1. 设计依据

`research/README.md` 的四组读数决定了两件事：

| 事实 | 设计含义 |
| --- | --- |
| 手势期最重长任务 202ms，CPU profile 里 `overflows()` 占 67.3% 采样，每帧最多 9N 次强制布局 | 手势期必须**完全不跑测量** |
| 冻结测量后仍有 56ms 长任务、~36fps（真实改宽度 + 引擎重排的裸代价） | 手势期不能改宽度，必须走**合成器属性** |
| `transform: translateX + scaleX` 预览 = 84 帧满帧、零长任务 | 预览路径就是 `translate` + `scaleX` |
| 叠加 3px 模糊后读数完全一致 | 模糊免费，可以一直挂着做遮挡 |
| 松手后本来就是 16.8ms 零长任务（因为宽度没变） | 新设计引入的「落定改宽度」是**新增成本**，必须靠预计算把它压回一帧 |

## 2. 拆分决策：为什么是单任务双里程碑，不是父子任务

按 Trellis 的口径，本请求里「手势期顺滑」与「落定期顺滑」确实可以各自独立验证，
但它们共享同一套状态机与同一份落定代码：M1 的落定必须先把宽度落下去，才会暴露
「一次实时适配 ≈ 9 次强制布局」这个新成本，M2 才有存在意义。拆成两个子任务会让
第二个子任务先改一遍 M1 刚写的落定分支。因此合并为单任务，用 `implement.md` 的
P2（手势期）/ P4（落定期）两个**独立验收门**分别把关。

## 3. 状态机

```
                     ┌──────────────── 双指第二指按下 ───────────────┐
                     │                                              ▼
 idle ───────────────┤                                          preview
   ▲                 └── −/+ 按钮 或 双击 ──────────────────────▶ settling
   │                                                                  │
   │                                    过渡动画结束 / 时长 0         │
   └──────────────────── commit（一次性落定） ◀───────────────────────┘
```

| 状态 | stage 上的 `data-schedule-zoom-preview` | 网格宽度 | 测量队列 | 变换 / 模糊 |
| --- | --- | --- | --- | --- |
| `idle` | 不存在 | 当前档位 | 正常 | 无（内联值清空） |
| `preview` | `"preview"` | **冻结在当前档位** | **挂起** | 跟手 `scaleX(k)` + 模糊 |
| `settling` | `"settling"` | 冻结在当前档位 | 挂起 | `k` 过渡到目标比例 + 模糊 |
| `commit` | 不存在 | 目标档位 | 恢复 | 清空 |

- 三条入口（双指 / `−`+ / 双击）**只有一个落定实现**；按钮与双击没有 `preview` 阶段，
  直接从 `idle` 进 `settling`（`k` 从 1 起）。
- `preview` / `settling` 期间若发生新的手势或新的按钮点击，取消当前过渡并重新开始，
  不排队。
- `prefers-reduced-motion: reduce` 时 `settling` 时长为 0 → 直接 commit（状态仍是 `settling`，
  只是立刻结束），保证终态与动画路径逐字节一致。

## 4. 变换放在哪一层，以及数学

**挂在 `[data-schedule-swipe-stage]`（既有的 `overflow-hidden` 裁剪层），不挂网格、不挂滚容器。**

理由（与规范里既有的告警同源）：被 `transform` 的后代会计入滚动溢出区域，写在滚容器或其祖先
内容上会实时污染 `scrollWidth`，既影响边缘阻尼切周的判定，也影响 `scrollLeft` 的钳位。
stage 本身就是裁剪层，缩放它不改变任何布局尺寸，`scrollWidth` / `scrollLeft` 全程不动。

```
transform-origin: 0 0
transform: translateX(tx) scaleX(k)
tx = xcStage * (1 - k)
```

- `k`：预览比例（连续）。`xcStage`：捏合中心在 **stage 局部坐标** 里的 X。
- `translate` 与 `scaleX` 都是合成器属性，插值时不触发布局（§1 已实测）。
- 只做 `scaleX`、不做 `scale`：与「缩放只改列宽、行高不变」的语义同构，纵向零失真。
- 落定后 `scrollLeft` 补偿复用既有公式（`setLiveZoom` 里那段）：
  `scrollLeft = (scrollLeft + xcInScroll) * k - xcInScroll`，其中 `k` 是**目标档位 / 起始档位**。
  这一步保证「清掉 transform 的瞬间」屏上内容不跳。

### 落定序列（同一帧内完成，只产生一次布局）

1. `grid.style.setProperty('--schedule-zoom', String(tier))` —— 真实宽度落地。
2. 逐格套用预计算快照（纯写：`display` / `--cc-scale` / 块宽）。**不读任何 DOM**。
3. `scroll.scrollLeft = …`（必须在宽度变更之后写，否则会按旧的 `scrollWidth` 钳位）。
4. `scrollEl.style.removeProperty('transform' / 'filter' / 'transition')` +
   清 `data-schedule-zoom-preview`；stage 同样清三个内联值。
5. `setZoom(tier)` 提交一次 React 状态（`data-zoom-level` / 信息分级随之更新），
   并恢复测量队列。

顺序上的两个硬点：**第 1 步必须在第 3 步之前**；**第 4 步必须是 `removeProperty`**
（规范明确禁止写 `translate3d(0,0,0)` —— 那会留下 `matrix` 而不是 `none`，误导后续断言）。

### 模糊

- 预览与过渡期：`filter: blur(var(--schedule-zoom-blur))`，默认 3px（实测 0/2/4px 无差异）。
- 落定后**延迟一个绘制帧再清**，让「宽度落地那一次重排」被模糊遮住，读起来是
  「对焦」而不是「卡一下」；`PREVIEW_BLUR_OUT_MS = 120` 的 `filter` 过渡，若引擎不能
  合成 `filter` 过渡则退化为直接清除（不影响终态）。
- `prefers-reduced-motion: reduce` 时不加模糊。

## 5. 冻结测量

`cellLayout.ts` 增加模块级闸门（不引入 React 状态）：

```ts
export function setCellLayoutSuspended(suspended: boolean): void
```

- `createCellLayoutQueue` 的 `enqueue` 在挂起时**只把 job 放进 `pending`、不排 rAF**；
  恢复时排一帧把 `pending` 一次刷完。作业集合去重语义不变，恢复后不会丢格子也不会重复测。
- `ScheduleCourseCell` 的 `ResizeObserver` 与 `useLayoutEffect` 都不用改：挂起时它们
  仍然会把 job 入队（纯 Set 写入，零读取），这正是想要的「不丢、不急」。
- 挂起只覆盖 `preview` / `settling` 两个状态；`commit` 之后立即恢复。

## 6. 档位排布预计算

### 6.1 快照形状

```ts
export type CellFitSnapshot = {
  /** 按 `optional` 顺序被隐藏的行数（0 = 都不隐藏）。 */
  hidden: number
  /** 兜底系数；1 = 未走兜底。 */
  scale: number
  /** 文字块宽度 px；0 = 退回整宽。 */
  width: number
}
```

这三个字段就是 `fitCourseCells` 会写到 DOM 上的**全部**东西（`hideOptional(i)` / `setScale` /
`setWidth`）。因此「读回快照」与「套用快照」都是既有写法的直接逆/正操作，不需要第二套规则。

### 6.2 键：把正确性交给键，而不是交给失效逻辑

```
geometryKey  = `${containerClientWidth}|${containerClientHeight}|${columns}|${isMobile ? 'mobile' : 'desktop'}`
contentKey   = `${course.id}|${name}|${classroom}|${teacher}|${parityLabel}|${note}|${startSection}-${endSection}`
slotKey      = `${geometryKey}${KEY_SEPARATOR}${contentKey}${KEY_SEPARATOR}${tier}`  // KEY_SEPARATOR = String.fromCharCode(0)
```

- 课程格的盒子尺寸是 `(geometryKey, tier)` 的纯函数 ⇒ 快照对该键有效。
- 快照内容是 `(contentKey, 盒子尺寸)` 的纯函数 ⇒ 键里带上内容签名后，
  **内容一改键就变，旧条目永远不会被读到**，不需要「内容变更时记得清缓存」这类易漏的失效逻辑。
- **节次跨度必须进内容签名**：同一门课改节次时课名/教室/教师都没变，而盒子高度变了；
  不进签名就会读到按旧高度算的排布（文字被裁）。
- **档位不进几何键**（它是独立维度，独立成 `slotKey` 的第三段）；**课程格宽度也不进几何键**
  —— 它是档位的函数，档位已经进键了。
- **换几何不清表**（实现期修正，见 `research/README.md` §9.2）：几何键进每条条目的键，换几何只是查不到，
  靠 LRU 淘汰。初版「`geometryKey` 变化时整表丢弃」在手机上会变成恶性循环：2x 出现水平滚动条后容器
  内容盒矮 15px，几何键在 1x（高）与 2x（矮）之间来回翻转，于是每次换档先把另一档刚算好的条目扔掉。
- 条目上限 `CACHE_MAX_ENTRIES = 256`（三套几何 × 18 格 × 3 档 = 108，留一倍余量），超出按插入序淘汰。
- 几何必须**按需读**而不是推送（实现期修正，见 `research/README.md` §9.1）：`ResizeObserver` 回调
  固定晚一帧，而落定后第一批查询就在下一帧，推送的键永远是上一档的。改为
  `setCellLayoutGeometryReader(() => …)` + `currentCellLayoutGeometry()`，在 `fitCourseCells` 批次
  开头读一次（此时落定宽度已写好，一次读取连滚动条状态一起算进布局）。
- `contentKey === ''` 表示**不可缓存**（夹具/结构不完整的格），永远走实测、永不入库。
### 6.3 两个填充来源

1. **真实适配时顺手记录**（零额外成本）：`fitCourseCells` 跑完一批后，对每个 job 读回快照
   并写进缓存。任何一次真实适配都会让它自己所在档位的条目变热。
2. **空闲预热**（把「首访档位的那一次卡顿」提前到用户看不见的时候）：
   - 把 `[data-schedule-grid]` 克隆到一个离屏宿主
     （`position:fixed;left:-99999px;visibility:hidden;pointer-events:none`，
     宽 = 滚容器 `clientWidth`、高 = 真实网格 `offsetHeight`、`--schedule-zoom: T`）；
   - 按 `[data-course-cell]` 建 job（与组件共用同一个 `createCellLayoutJob`），
     **按格子分片**，每片一个 `requestIdleCallback` 切片；
   - 每片跑完读回快照写进 `(geometryKey, T)` 下的对应 `contentKey`；
   - 任何 `pointerdown` / `touchstart` / 滚动 / 档位变化 / `geometryKey` 变化 → **立刻取消并卸载克隆**；
   - 只预热**非当前**的两个档位。

  成本口径：`fitCourseCells` 的读阶段无法再分片（每片仍会强制整文档布局），所以预热是
  「若干次 ~几十毫秒的空闲切片」，不是零成本。这正是它必须可取消的原因。

  落地顺序上这条排最后：即使预热完全没跑成，缓存也有来源 1 兜底，功能与终态不变。

### 6.4 目录与模块边界

| 文件 | 职责 |
| --- | --- |
| `zoomPreview.ts`（新） | **纯函数核**：比例→`tx` 换算、档位比、过渡时长/缓动常量、`prefers-reduced-motion` 判定、落定写入计划 |
| `zoomPreview.test.ts`（新） | 钉住常量、换算、降级与三条入口的等价性 |
| `cellLayoutCache.ts`（新） | 快照类型、缓存读写、`geometryKey`、`resolveTierApply()`（纯函数：快照表 → 逐格写入计划） |
| `cellLayoutCache.test.ts`（新） | 钉住「命中即零读取」、键的构成（几何 × 内容 × 档位）、LRU 淘汰、换几何**不**串味 |
| `cellLayout.ts`（改） | 抽出 `createCellLayoutJob(button)`（组件与预热共用）、加挂起闸门、批次跑完回读快照 |
| `ScheduleCourseCell.tsx`（改） | 改用抽出的 job 构造器；补 `data-course-key`（内容签名，作为缓存键与断言锚点） |
| `ScheduleTable.tsx`（改） | stage 上补 `data-schedule-zoom-stage`；把几何**读取器**（滚容器内容盒 × 列模板 × 断点）注册给缓存 |
| `useScheduleZoom.ts`（改） | 状态机、手势 → 预览、按钮/双击 → 过渡、统一落定 |
| `hooks/useZoomTierWarmup.ts`（新） | 空闲预热与取消 |

`createCellLayoutJob` 抽出来后，组件里那段 `useLayoutEffect` 只剩「挂载即入队 / 字体就绪补测 /
`ResizeObserver` 观察」这三件事，测量规则本身只剩一处真源。

## 7. 与既有契约的边界

| 契约 | 本设计如何保持 |
| --- | --- |
| 1x 恰好铺满、无横向滚动 | `ZOOM_MIN = 1` 与 `min-w-[calc(100%*var(--schedule-zoom))]` 不动；预览期宽度不变，落定值仍取自 `ZOOM_TIERS` |
| 「不用 `transform: scale`」 | 改为受控例外：**变换只在 `preview`/`settling` 存在，静止态必须清空**；新增守卫断言 + AC3 钉住；规范同任务内更新 |
| 边缘阻尼切周 | 缩放变换写在 stage（祖先），不写滚容器；第二指按下时切周手势已 `reset()`，两者天然互斥 |
| 单指纵向滚动 / 格点按 | 缩放路径不 `preventDefault` 新事件、不改 `touch-action`；既有 `pointercancel` 与 `isTapSizedMove` 逻辑原样保留 |
| 缩放值不持久化 | 状态机只改内存状态，不碰 store |
| 「测量走共享队列 + 分阶段批量读写」 | 闸门加在队列上而不是各格上，批量语义不变；快照套用是纯写，比原来更严格 |
| 缺勤/配色/非本周/单双周 | 完全不动；`data-course-*` 观测锚点全部保留，只新增 `data-course-key` 与 `data-schedule-zoom-preview` |
| `min-h-full`（旧 WebView 可滚） | 网格 class 不动；克隆宿主的高度显式取自真实网格 `offsetHeight` |

## 8. 常量（单一真源，放 `zoomPreview.ts`）

| 常量 | 值 | 依据 |
| --- | --- | --- |
| `PREVIEW_BLUR_PX` | 3 | 实测 0/2/4px 无差异，取中间值掩盖 `scaleX` 形变 |
| `SETTLE_DURATION_MS` | 180 | 与 `weekSwipe.ts` 的 `SNAP_BACK_DURATION_MS` 同一量级，不引入第二套时长口径 |
| `SETTLE_EASING` | `cubic-bezier(0.22, 1, 0.36, 1)` | 收尾缓出，落定时速度已接近 0，宽度落地不明显 |
| `PREVIEW_BLUR_OUT_MS` | 120 | 遮住落定那一帧的重排 |
| `REDUCED_MOTION_DURATION_MS` | 0 | R7 |

## 9. 兼容与回滚

- 快照缓存是**纯优化**：删掉缓存模块、把落定里的「套用快照」换成「恢复测量后照常入队」，
  即回到「手势期顺滑、落定期一次实测」的中间态，不会出现错误排布。
- 变换只存在于两个显式状态里，回滚时删掉 preview/settling 分支即可回到纯 `--schedule-zoom` 驱动。
- 预热可以整体关掉（一个常量开关）而不影响任何终态。

## 10. 验证策略

| 验收 | 手段 |
| --- | --- |
| AC1 手势期帧率 | `research/zoom-perf.mjs` 真实双指模式，取 `touchStart`→`touchEnd` 窗口 |
| AC2 命中即零读取 | vitest：给套用路径喂一个「读就抛」的假 job |
| AC3 静止态 | CDP：断言 stage / 滚容器的内联 `transform`、`filter` 为空，`computed` 为 `none`，`data-zoom-level`、`min-width`、`data-schedule-zoom-preview` |
| AC4 三入口 + 降级 | vitest 钉常量与状态机等价；CDP 用 `Emulation.setEmulatedMedia` 跑 `reduce` |
| AC5 逐格适配 | 复用 `10-11` 任务的 `verify-cell-layout.mjs` + `run-cell-layout-verify.sh`（三视口 × 三档位） |
| AC6 切周回归 | 复用 `10-11` 任务的 `week-switch-perf.mjs` + `run-browser-perf.sh` |
| AC7 门禁 | 六项命令 + 更新的 `scheduleSourceGuard.test.ts` |
