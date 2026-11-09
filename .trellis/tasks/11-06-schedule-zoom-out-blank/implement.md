# 执行计划：课表缩小空白与模糊修复

## 实施顺序

- [x] **P1 数学与回归夹具**：在 `zoomPreview.test.ts` 先加入完整内容坐标、覆盖边界、最小档位铺满与异常输入用例；更新 `zoomPreview.ts` 的 `previewTransform` 输入与钳位实现，删除模糊纯函数和常量。
- [x] **P2 状态机改挂内容**：`useScheduleZoom.ts` 冻结 contentWidth / viewportWidth / contentCenterX，网格承担 transform 与 settling transition，stage 只承担相位；删除全部 blur 调度和收尾字段；commit 在写 scrollLeft 前清预览。
- [x] **P3 原点与源码契约**：`ScheduleTable.tsx` 给网格加 `origin-top-left`；更新 `scheduleSourceGuard.test.ts`，防止回退到视口缩放、遗漏原点或重新引入 blur。
- [x] **P4 浏览器可见行为**：把 `research/probe-content-transform.mjs` 收敛为产品路径验收，覆盖双指、− 按钮、双击在左/中/右滚动位置的缩小覆盖与终态；保存报告，必要时补一张缩小中间态截图。
- [x] **P5 性能与兼容回归**：复用/调整归档探针验证手势帧、长任务、无模糊、真实宽度冻结、落定终态；跑三档逐格与边缘切周回归。
- [x] **P6 规范与门禁**：更新 `mobile-schedule-layout.md` 的宿主、坐标、边界与无模糊契约；执行完整质量检查并审阅最终 diff。

## 验证命令

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm webview:check-css
pnpm test:android-assets
```

浏览器验证使用生产构建、412×731 DPR2 与合成课程夹具，不接触真实用户数据。性能门禁保持：手势期无 ≥50ms 长任务、最大帧间隔 ≤50ms。真机最终观感由用户复核，不把桌面 Chrome 结果冒充真机结果。

## 风险文件与回滚点

- `zoomPreview.ts`：纯数学可独立回滚，单测必须先证明覆盖区间。
- `useScheduleZoom.ts`：唯一状态机改动点；任何新增逐帧 DOM 读取都视为越界。
- `ScheduleTable.tsx`：只允许新增变换原点，不改网格尺寸 class 与 DOM 高度链。
- `scheduleSourceGuard.test.ts` / 规范：跟随真实宿主更新，不能为通过测试而删掉关键行为断言。

## 开始前复核

- 用户已明确主要问题是缩小半屏空白，次要问题是模糊。
- 规划探针证明内容变换 + 覆盖钳位可行，无必要引入双缓冲或截图。
- 最终计划需用户明确批准后才能运行 `task.py start` 和修改产品代码。
