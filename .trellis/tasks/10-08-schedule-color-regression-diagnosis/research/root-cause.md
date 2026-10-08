# 课表配色差异：排查结果

## 结论

当前课表浅底深字的直接来源是提交 `718812f`（2026-10-03，`feat(schedule): 课程格改浅底深字配色并按课程号稳定分配颜色`）。该提交明确替换了课程卡片色板和文字层级，并重写了课程到色板的分配方式。

手机端导入 PR #27 没有修改课表组件。改色提交在该 PR 合并前已进入 `master`，所以 PR 合并后的版本包含了它，但导入界面改动不是配色变化的来源。

## 代码证据

对比 `718812f^` 与 `718812f`：

- 旧色板在 `app/features/schedule/constants.ts`：8 组彩色填充（例如 `#87e5d4`、`#7bb7ef`、`#ee7c9b`、`#eab776`），文字为白色；非本周课程仍按课程色淡化。
- 新色板在 `app/features/schedule/courseColor.ts`：卡片换为高明度浅色填充（例如 `#f7e9de`、`#e0f5e9`、`#e2ebf8`），课名改为同色相深色，教室等次要信息也改为较暗的低饱和色；非本周课程统一改成灰色主题。
- `ScheduleCourseCell.tsx` 直接把 `theme.surface`、`theme.title`、`theme.body` 用于卡片和文字，因此这是组件自身配色变更，不是导入界面或全局样式意外继承造成的。
- 课程映射也改变了：旧实现用 `courseId` 哈希选择色板档位；新实现先对整学期的 `courseId` 去重排序，再按顺序循环分配 8 个档位。除整体明暗变化外，单门课对应的色相也可能因此变化。

## 时间线与导入 PR 排除

- `340b211`（tag `android-beta-21`）早于 `718812f`，对应旧配色代码。
- `718812f` 于 2026-10-03 提交；`0d36899` / tag `android-beta-22` 已包含该改色提交。
- 手机端导入改动 `3ee4a4b` 于 2026-10-08 提交，改动文件仅位于 `app/components/` 和 `.trellis/spec/frontend/component-guidelines.md`，没有 `app/features/schedule/` 文件。
- 合并提交 `8d8680c` 的第一父提交为 `43b6ec5`；`718812f` 已是其祖先。因此合并 PR #27 时，改色代码早已在主线上。

## 可复核命令

```bash
git show 718812f^:app/features/schedule/constants.ts
git show 718812f -- app/features/schedule
git diff --name-only 43b6ec5 3ee4a4b
git merge-base --is-ancestor 718812f 43b6ec5
```

排查没有修改产品代码；本文件只记录诊断证据。
