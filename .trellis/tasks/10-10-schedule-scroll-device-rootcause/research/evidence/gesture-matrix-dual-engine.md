# 修复后双引擎手势回归（汇总）

包：`android-beta-30`（含 `min-h-full` 修复 + 诊断浮层）。模拟器屏幕统一 `1080×1920@420`；
拖动起点固定在 CSS `y=400`（浮层占底部 34vh，起点必须留在浮层**上方**，否则手势落在浮层上、白测一轮）。

| 项目 | Chrome **120**（API 32） | Chrome **149**（API 37.1） |
| --- | --- | --- |
| 滚动容器 | `clientH 510 / scrollH 780 / maxTop **270**` ✓ | `clientH 501 / scrollH 780 / maxTop **279**` ✓ |
| 网格 | `clientH 780 / scrollH 780`（不再把行溢出藏在盒子里） | `clientH 780 / scrollH 780` |
| 单指竖直（CDP 矩阵） | `0 → 270.1` ✓ | `0 → 278.9` ✓ |
| 单指竖直（系统级 `input swipe`，非 JS） | `0 → 270 = max` ✓ | `0 → 279 = max` ✓ |
| 双指平行竖直 | `0 → 0` ✗ | `0 → 0` ✗ |
| 中途落下第二指 / 擦碰第二点 | — | `0 → 0` ✗ |
| 双指张开（应用内缩放） | `--schedule-zoom 1 → 2` ✓（`maxLeft 0 → 394`） | `1 → 2` ✓ |
| 缩放后单指竖直 | `0 → 270.1` ✓ | `0 → 278.9` ✓ |
| 左边缘横滑切周（开关**开**） | `data-current-week 3 → 2` ✓ | `3 → 2` ✓ |
| 开关**关**：边缘横滑 | 周次保持 `2`（不切）✓ | 周次保持 `3`（不切）✓ |
| 开关**关**：单指竖直（系统级） | `0 → 270 = max` ✓（纵向不受影响） | `0 → 279 = max` ✓ |
| 浮层自判 | `SCROLL_OK` ✓ | `SCROLL_OK` ✓ |

- 双指/多触点那三行的失效是**已知的独立缺陷**（滚动容器 `touch-action: pan-x pan-y`），
  已由任务 `10-10-schedule-touch-action-multitouch` 承接，与本修复互不影响（矩阵里单指各项同时通过即为证明）。
- 原始读数：
  - Chrome 120 → `a32-chrome120-regression-after-fix/`（其中「开关关」三项在后续 Chrome 149 复跑时被同名文件覆盖，
    实测值记录为上表：`stored=false`、周次不变、`scrollTop 0 → 270`）；
  - Chrome 149 → `m37-chrome149-regression-after-fix/`（含 `toggle-off-*.json`）。
