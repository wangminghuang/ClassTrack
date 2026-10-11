# 实施计划

## 审批门禁

用户在 2026-10-11 明确回复「确认」，批准本规划摘要并授权实施；任务已 `task.py start`（`in_progress`）。本项目 inline，不调用子代理。

## 顺序

- [x] 创建任务并确认卡顿集中在松手换周。
- [x] 建立真实 CDP 触摸 + rAF/longtask 性能循环，用生产构建复现（基线：672–824ms 长任务）。
- [x] 采 CPU profile，热点定位到课程格自适应测量的同步布局读取。
- [x] 阅读 trellis-before-dev、组件 / Hook / 类型 / 质量规范及复用指南。
- [x] 用单变量实验区分「无依赖 effect 全量重测」与「每格读写交错」的贡献，逐步保留基线读数（E3、E4）。
- [x] 先写失败测试再改实现：`cellLayout.test.ts` 6 例覆盖阶段读写顺序、丢弃优先级、兜底阶梯停止、宽度回退、队列去重与撤销。
- [x] 实施修复：测量 effect 改为内容依赖 + `cellLayout.ts` 共享队列分阶段批量读写。
- [x] 重建生产资产，跑原始左右切周循环：无 ≥50ms 长任务、最大帧间隔 50ms。
- [x] 跑课程格尺度场景（360/412/1440 × 1x/2x × 跨周）violations = 0；滚动与缩放链未改动，由既有守卫覆盖。
- [x] 跑相关单测 → 全量测试（413 用例）→ typecheck → lint（0 problems）→ format:check → build → webview 兼容产物检查 → android 资产检查。
- [x] 更新 `mobile-schedule-layout.md`（测量契约与两条新验收脚本）、`research/README.md` 与 prd 验收结果。
- [ ] 真机（Android WebView）与用户设备复核：本机沙盒无法构建 APK（只读 `/home/yetongy/.gradle` + 无 DNS），已如实记入 `research/README.md` §4。
- [ ] 提交：按已批准方案「不自动提交」，是否提交与提交信息由用户决定。

## 主要命令

```bash
pnpm exec vitest run app/features/schedule
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm webview:check-css
bash .trellis/tasks/10-11-schedule-week-swipe-jank/research/run-cell-layout-verify.sh .trellis/tasks/10-11-schedule-week-swipe-jank/research/cell-layout
PERF_ASSERT=1 bash .trellis/tasks/10-11-schedule-week-swipe-jank/research/run-browser-perf.sh 1 .trellis/tasks/10-11-schedule-week-swipe-jank/research/after-cpu1.json
bash .trellis/tasks/10-11-schedule-week-swipe-jank/research/run-browser-perf.sh 4 .trellis/tasks/10-11-schedule-week-swipe-jank/research/after-cpu4.json
```

## 风险文件

`ScheduleCourseCell.tsx` 控制全部文字显隐/字号和块居中，SSR测试不能验证DOM测量，必须用真实浏览器验证；`useWeekSwipeGesture.ts` 原则上不改；`ScheduleTable.tsx` 保留网格高度兼容性。基线profile较大，可记录热点摘要并移除不必要原始大文件，保留可重复采集命令。

本机沙盒注意：`pnpm lint` 会命中 PATH 里的全局 ESLint 6.4.0（报「找不到配置文件」），
用仓库锁定版本跑即可：`node node_modules/eslint/bin/eslint.js . --report-unused-disable-directives --max-warnings 0`（0 problems）。
`pnpm build` 与 `pnpm typecheck` 不受影响。Gradle 构建在本沙盒不可用（只读 `~/.gradle` + 无 DNS），故未做真机复核。
