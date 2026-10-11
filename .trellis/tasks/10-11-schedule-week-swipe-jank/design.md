# 技术设计：松手切周的布局阻塞

## 证据与定位边界

- 现有生产构建，Chrome 155，412×731 CSS px，归档合成课表 18 格，CPU rate=1。
- `PERF_ASSERT=1 PROFILE=1 bash .../research/run-browser-perf.sh 1 .../research/baseline-profile.json` 已运行，性能断言失败：6 次左右交替切周均发生 672–824ms 主线程长任务，松手后最大帧间隔 1083–1317ms；一次只切一周，最终状态正常。
- CPU profile 里最重的两条栈都定位到 `ScheduleCourseCell.tsx:98` 的 `content.scrollHeight - content.clientHeight`，累计约 7161ms；这不是 React 渲染本身或 localStorage 序列化的大开销。
- `ScheduleCourseCell.tsx:92–177` 每次 render 都重跑 layout effect；每格同步 apply 后还安排 rAF、fonts.ready 和 ResizeObserver 补测。apply 中写 display、字号和宽度后又读布局，导致重复同步布局。
- 已复现同类松手停顿，但用户手机型号/WebView版本尚未知；不能把桌面耗时当成其设备耗时，也不能声称最近高度修复是因果来源。

## 修复边界

课程格空间自适应测量为主要修改位置；手势动画和 `min-h-full` 保持原样。先用可观测的重复测量次数和原始性能循环锁定因果，再实施。

## 设计

1. 为课程格测量建立明确的失效条件：内容/单双周标签/备注变化、外层可用尺寸变化、字体加载完成。颜色、出勤图标、回调引用或仅周号变化不应无条件重测。
2. 收敛同一格首次测量和 ResizeObserver 首次通知的重复；保留真正尺寸变化的重测。不能删掉首帧/字体纠偏能力以换取性能。
3. 若只消除重复仍不满足门禁，则将多格测量按阶段调度：同轮先写各格基准样式，再批量读，逐级丢弃/缩字号阶段先批量写再批量读，最后收窄文字块并验证。避免每格单独读写交错造成整张网格反复布局。调度器必须可取消，解绑不得留下旧回调。
4. 保留现有优先级、8–15px字号上下限、0.05兜底阶梯、教室恒显、文字块水平居中及宽度溢出回退；不改变课程数据、显示store或对外组件调用方式。
5. 不以固定延时、隐藏内容、减少课程字段、提前播放动画掩盖主线程阻塞。

## 验证契约

- 原始合成课表左右各3次的松手400ms窗口：rate=1下消除 >=50ms 长任务，最大帧间隔 <=50ms；如宿主噪音影响数值，记录重复样本，不降低标准掩盖未解决原因。
- rate=4作压力对照，记录改善比例，不把该数值当真机指标。
- 同周字段/出勤变化、跨奇偶周、长课名、1x/1.5x/2x、360/412/1440视口，仍满足空间自适应契约。
- 原生WebView可用时重跑真实横滑、竖向到底和缩放；不可用则如实列出未验证范围。

## 回滚

仅回滚本任务课程格测量优化及新辅助模块；不回滚 `ceef1b9` 的高度修复。性能不达标不得结案。

## 实际实施（2026-10-11）

分两步落地，每步都跑同一个原始性能循环（`research/README.md` 的 E3、E4）：

1. **内容依赖**：`ScheduleCourseCell.tsx` 的测量 `useLayoutEffect` 从「每次 render 重跑」改为只在
   `[course.name, course.classroom, course.teacher, parityLabel, note]` 变化时重建；配色、出勤角标、回调引用变化不再触发重测。
2. **共享队列 + 分阶段批量读写**（新模块 `app/features/schedule/cellLayout.ts`）：
   - `createCellLayoutQueue(requestFrame, cancelFrame, fit)` 按「格」去重入队，挂载 / `ResizeObserver` / 字体就绪
     三类通知合并成同一帧一次 `fit(jobs)`；`remove(job)` 撤销卸载格子的待执行任务。
   - `fitCourseCells(jobs)` 固定阶段执行：`prepare`（写）→ 读溢出 → `hideOptional`（写）→ 读溢出 →
     `setScale`（写）→ 读溢出 → 读各行实际宽度 → `setWidth`（写）→ 再读一次决定退回整宽。
     轮数与阶段数与课程格数量无关。
   - `ResizeObserver` 回调先比对 `contentRect` 宽高，未真变不入队（`observe()` 的首次回调与首测重复）。
   - 字体纠偏保留：挂载即入队；`document.fonts` 仍在 loading 时补一次 `ready`，并监听 `loadingdone`。

## 结果对照（rate=1，同一夹具与手势）

| 指标 | 基线 | 仅内容依赖 | 内容依赖 + 批量 |
| --- | --- | --- | --- |
| 松手后最大帧间隔 | 1083–1317ms | 67–300ms | **33.5–50ms（多次复跑）** |
| 最长主线程任务 | 672–824ms | 54–156ms | **无 ≥50ms** |

课程格视觉契约由 `research/verify-cell-layout.mjs` 在 360/412/1440 × 1x/2x × 跨周逐格断言，violations = 0。
单测 `app/features/schedule/cellLayout.test.ts` 6 例钉住阶段顺序、丢弃优先级、兜底阶梯、宽度回退与队列去重/撤销。
