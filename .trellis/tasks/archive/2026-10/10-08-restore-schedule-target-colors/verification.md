# 首次恢复目标色板的验证（`51f08a8`）

- `pnpm test` — 40 test files passed, 388 tests passed。
- `pnpm typecheck` — passed。
- `pnpm lint` — passed; ESLint printed its existing React version configuration warning.
- `pnpm format:check` — passed。
- `git diff --check` — passed。
- `.trellis/spec/frontend/mobile-schedule-layout.md` 已定义本任务恢复的目标色板，本任务无需改动 spec。

本项目使用 inline 模式，任务以 `--allow-empty-context` 启动；不会为子代理填充 context manifests。

## 课程分配逻辑回退验证（2026-10-08）

- 最小复现：`1001` / `1009` 在修复前同为档位 0、`#87e5d4`；回退后分别为档位 0 / 1、`#87e5d4` / `#7bb7ef`。
- `pnpm exec vitest run app/features/schedule/courseColor.test.ts`：产品代码修改前 5 项失败，回退后 5 项通过。
- 历史差分：0 / 2 / 8 / 9 / 40 门课程及反向输入的映射与 `718812f` 一致。
- `pnpm test`：41 个文件、393 项通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`：全部通过。
- `git diff --check`：通过。
- 自检：唯一产品模块改动为 `courseColor.ts` 的分配与兜底，目标主色板和淡化色原样保留；`SchedulePage` 继续使用整学期课程建立映射。
- 已同步 PRD、任务描述及 `.trellis/spec/frontend/mobile-schedule-layout.md`，记录不能将目标色板恢复与哈希算法回退混为一谈。
- 已移除碰撞哈希，未留下调试日志或临时复现文件。
