# Mobile Schedule Layout

> 手机端（<768px）课表的布局契约：整周自适应铺满、信息分级、节次时间推导与 1x~2x 缩放。

---

## Overview

课表是唯一需要在手机上“一次看全一周”的页面，但 7 列 × 12 节的网格在 400px 左右宽的屏幕上天然拥挤。本文件固定这套取舍：**宽度优先给整周可见，信息按缩放分级展开**，桌面端（≥768px）保持原有网格不动。

相关代码：`app/features/schedule/ScheduleTable.tsx`、`ScheduleCourseCell.tsx`、`SchedulePage.tsx`、`hooks/useScheduleZoom.ts`、`utils.ts`、`constants.ts`。

---

## Layout Contract

> **视口高度锚点（前置依赖）**：本页所有「铺满剩余高度 / 内部滚动」的行为都依赖 `html/body` 的高度锚点。
> `height: 100%` 兜底必须写在 `@supports (height: 100dvh)` 块**之外**，否则不支持 `dvh` 的旧 WebView
> （Chromium ≤ 107，Android 12 出厂 WebView 就在这条线以下）上 `html/body` 会变成 `height: auto`，
> 课表滚动容器 `scrollHeight == clientHeight`、**完全无法上下滑动**，且溢出部分被 `body{overflow:hidden}` 裁掉。
> 写法契约、无兜底特性清单与两条防回归检查见 `quality-guidelines.md` 的「构建产物的兼容性契约（视口高度锚点）」。
> **双保险（2026-09-29 追加）**：应用外壳自己还有一条只在「不支持 `dvh` 的引擎」上生效的锚点
> （`@supports not (height: 100dvh)` 里给 `.app-viewport` 设 `100vh`）—— 即使 `html/body` 那层失效，外壳仍成立。
> 写法与实测见 `quality-guidelines.md` 的同一节。

| 能力 | 手机端 (<768px) | 桌面端 (≥768px) |
| --- | --- | --- |
| 网格最小宽度 | `min-w-[calc(100%*var(--schedule-zoom,1))]`（1x 时恰好等于容器宽度） | 保持 `md:min-w-[760px]` |
| 网格列 | `grid-cols-[2rem_repeat(7,minmax(0,1fr))]`；开启「收起整周无课的日期列」时改由内联样式给出（见下方该开关的契约） | `md:grid-cols-[4rem_repeat(7,minmax(0,1fr))]` |
| 行高 | `grid-rows-[2.25rem_repeat(12,minmax(3.875rem,1fr))]`：每节 ≥3.875rem（412×915 下每节 62px、二连节格子 121px），再往下会被内容最小高度顶住；**改上下内边距后必须复核超长课名格是否被迫缩字号** | 同左 |
| 页面内边距 | `px-2`（保证 360px 视口仍有 44px 列宽） | `md:px-5` |
| 课名行数 | 不截断（任何端都无 line-clamp）；用 `break-words`（**不是** `break-all`）：超宽拉丁串（如 `（Python）`）按需词内断开，宁可词内断也不溢出被裁 | 同左 |
| 文字块对齐 | **文字块整体在卡片里居中、块内文字仍左对齐**：内层块由实测收窄到「最长行宽」，外层 `items-center` 居中（实测 46.6px 卡片 → 块 30px、左右各 8.3px）。**不要**用 `text-center` 逐行居中 | 同左 |
| 教室 | 恒显（**无 `@` 前缀**：课名纯白加粗、教室小一号白色 85%），不截断；`break-words` 让断点落在连字符后（`28-` / `A203`），`break-all` 会切断数字（`28-A20` / `3`） | 同左 |
| 教师 | 由格子**实测内容高度**决定：放得下就整行显示（1x 手机的二连节格子通常放得下），放不下整行隐藏 | 同左 |
| 备注 | 同「教师」，且优先级最低：空间不够时第一个被丢弃 | 同左 |
| 格子视觉 | **照参考图逐像素采样的 8 组平色** + 纯白字 + **半透明白描边**：`courseColors` = 薄荷 `#87e5d4`／青蓝 `#7bb7ef`／紫蓝 `#84aef7`／藕荷紫 `#bcaaf5`／玫瑰 `#ee7c9b`／浅粉 `#e7a0b3`／珊瑚 `#e98d78`／金橙 `#eab776`（参考图本身即平色、无渐变）；描边、圆角、内边距、出勤角标尺寸**全部由课程格自身的尺寸推导**（见下方「课程格尺度体系」）：常态描边是半透明白内阴影 `inset 0 0 0 var(--cc-ring)`、手机上约 2px —— **必须半透明**，纯白内描边会被看成「卡片被缩小」；**缺勤格**把同一层描边换成实色红（`CELL_ABSENT_RING_CLASS`，宽度同为 `--cc-ring`，见下方「出勤表现」） | 同左 |
| 非本周课 | 由该课自身颜色**推导**的淡化色（`courseOutOfWeekColors`：色相不变、HSL 亮度 +0.067、饱和 ×0.42；回代参考图样本 `#eab776 → #d4c3ae` 精确成立），不用固定灰卡 / opacity | 同左 |
| 网格线 | 所有行/列连续细线：空格与**有课程的格子容器都贴 `border-r`/`border-b`**，课程卡以 `p-px` 内缩 1px 落在线格上；最右列/最末行不贴边线 | 同左 |
| 出勤痕迹 | **只有做过出勤判断的格子才有痕迹**（判据 `isAttendanceMarked()`，与看板同源；未标记 / 只写备注的格子完全中性，**不变淡也不出角标**）。已上 = 右下白色打勾角标；缺勤 = **实色红描边 `rgb(239 68 68)`**（`CELL_ABSENT_RING_CLASS`，宽度仍走 `--cc-ring`）+ 右下警示角标，卡片**不淡化**（详见下方「出勤表现」）。**两层开关都要满足**：个人中心「出勤统计」已开启（能力层）**且**「课表显示 → 在课表上显示出勤状态」没被关掉（显示层）；非本周课不叠加出勤痕迹（灰色态优先） | 同左 |
| 信息显隐优先级 | 课名 > 教室（这两行是硬要求，**永不丢弃**）> 单双周/「非本周」标签 > 教师 > 备注；丢弃顺序反向，且只整行隐藏、不裁半截 | 同左 |
| 节次列时间 | 显示（节号 + 最多两行时间） | 不显示（只有节号） |
| 节次列表头 | 月份（如 `9月`） | `节` |
| 缩放 | 1x / 1.5x / 2x，双指捏合 + −/+ 按钮 + 双击 | 不启用 |
| 边缘拖动翻周 | 「左右边缘滑动切换周」开启时：横向滑到最左/最右边缘后继续同向拖 → 阻尼跟手位移 → 松手切上/下一周（详见下方「横向轴的边缘阻尼手势」） | 不启用 |
| 顶栏控件尺寸 | 一律 `h-9`（36px），图标 `size-4`；上一周/下一周与「添加到桌面」为 `h-9 w-9` 图标按钮 | 同左，`md:flex` 单行排布 |

顶栏（`ScheduleHeader.tsx`）曾经用 `h-10`（40px）+ `size-5` 图标，2026-09-20 按产品要求整体压到 `h-9` / `size-4`，为「添加到桌面」入口腾出同一行的位置：手机端左侧动作组是 `grid-cols-[2.25rem_2.25rem_1fr_1fr_2.25rem]`（两个翻周图标 + 全部已上/全部未上 + 添加到桌面），右侧是 `grid-cols-2`（第 N 周 / 返回本周）。**新入口必须留在左侧动作组内**：塞进右侧那两列网格会让它换行成第三行，顶栏反而变高（真机截图确认过）。可访问性标签（`aria-label="上一周"` 等）保持原样，是自动化定位这些控件的唯一稳定锚点。

**顶栏列数随「出勤统计」开关变化（2026-09-24 起）**：「全部已上 / 全部未上」与它们共用的确认弹窗只在个人中心打开出勤统计时渲染。手机端左侧动作组因此有两套列数：开启时 `grid-cols-[2.25rem_2.25rem_1fr_1fr_2.25rem]`（上一周 / 下一周 / 全部已上 / 全部未上 / 添加到桌面），关闭时 `grid-cols-[2.25rem_2.25rem_2.25rem]`（上一周 / 下一周 / 添加到桌面）—— 少掉两个按钮还留着 `1fr` 空洞会让顶栏看起来断裂。两条分支都由 `ScheduleHeader.test.ts` 的 SSR 断言钉住。

**响应式断点统一用 `md:`（768px）**，与 `useIsMobile()`（`max-width: 767px`）保持一致。历史代码里的 `sm:` 前缀（640px）会让 640–767px 的窄平板出现“网格按手机、单元格按桌面”的割裂，改动时一并统一到 `md:`。

---

## 课程颜色分配

- 色值采用上表中的目标 8 色与同序淡化色；分配逻辑采用 `718812f` 已有的顺序分配。
- `buildCourseColorMap(classes: Class[]): Map<string, number>` 接收整学期课程（由 `SchedulePage` 构建），按 `courseId` 去重、`localeCompare` 排序，以 `index % 8` 分配档位。不要用当周过滤后的课程重新分配。
- 同一整学期数据中，同一课程跨周、跨节次和刷新后颜色相同；输入重排和同课重复记录不影响结果。8 门以内不同课程颜色不同，第 9 门起循环复用；增删课程可能改变排序后的档位，这是历史行为。
- `resolveCourseTheme(courseId, colorMap, isOutOfWeek, paletteId = 'original')` 对本周和非本周使用同一档位，后者取所选色板的对应淡化色；未收录的课程沿用历史档位 0 兜底。
- **不要把恢复目标色板等同于恢复更早的哈希算法**：`51f08a8` 曾将顺序分配误换成哈希取模，课程号 `1001` / `1009` 仅两门课就都落到档位 0。回归点在 `courseColor.test.ts`，覆盖这对课程的本周/非本周重色、八门不同课程、重复与乱序数据、第九门循环和兜底行为。

### 个人中心配色选择（2026-10-08）

1. **范围**：个人中心 → 课表显示 → 课程配色，提供原配色与用户确认的新配色。两套均有八色课程样卡与非本周淡化色预览，预览和正式课表都读取 `courseColor.ts` 的 `COURSE_PALETTES`，不得分别写一套色值。
2. **签名**：共享 `CoursePaletteId = 'original' | 'adjusted'`；`setCoursePalette(value: CoursePaletteId)`；`resolveCourseTheme(courseId, colorMap, isOutOfWeek, paletteId)`。`ScheduleTable` 订阅显示 store 的 `coursePalette` 并传入主题解析，切换后立即渲染。
3. **契约**：默认 `original`（用户明确要求），设备 key 为 `class-track-schedule-display`，`partialize` 含 `coursePalette`。新配色仅将档位 2 的 `#84aef7` 改为草绿 `#a7cc8a`、档位 5 的 `#e7a0b3` 改为紫粉 `#e9a8d2`；对应淡化色为 `#bbc7b1` / `#e3d0dc`（沿用 HSL 亮度 +0.067、饱和 ×0.42），其余六档主色与淡化色原样保留。两套色板共用课程到档位的映射。
4. **校验**：存储值为 `original` / `adjusted` 时恢复用户选择；缺失、null、数字或未知字符串回落当前默认值，避免索引不存在的色板。此偏好不进入课程备份或多学期数据。
5. **案例**：好——选择新配色，刷新后仍选中新配色，非本周课程也取其同序淡化色；基础——全新或旧设备缺字段时使用原配色；坏——持久化未知色板标识时崩溃，或切换色板时重算课程档位。
6. **验证**：`courseColor.test.ts` 断言仅两档主色和淡化色改变、两套均八色独立、切换不改映射；`scheduleDisplayStore.test.ts` 验证默认、保存/合并恢复与非法值回落；`ScheduleDisplaySettings.test.ts` 断言两套选择及完整预览。浏览器检查手机布局、真实切换、刷新恢复和课表应用。
7. **错误与正确**：错误——复制临时预览的 CSS 覆盖到正式页面，或在切换时清空课程/出勤数据；正确——共享色板，通过独立显示 store 选择主题。用户确认后已移除临时 `palette-preview` 页面。

---

## 出勤表现（2026-09-28 起）

课表上的出勤痕迹**只属于做过出勤判断的格子**，判据是 `isAttendanceMarked(mark)`（`app/store/utils.ts`，与看板 `isAbsentSession()` 同源，**不要另写一份**）：

| 格子的状态 | 描边 | 右下角标 | `title` 文案 | 卡片淡化 |
| --- | --- | --- | --- | --- |
| 已上（`isAttended === true`） | 半透明白（常态） | 白色打勾 `CheckCircle2` | 含「已上」 | 无 |
| **缺勤**（做过判断且未上） | **实色红 `rgb(239 68 68)`**（`CELL_ABSENT_RING_CLASS`） | 警示 `CircleAlert` | 含「未上」 | **无** |
| 未标记 / 只写备注（`attendanceMarked === false`） | 半透明白（常态） | 无 | 不提出勤 | 无 |

两条容易改回去、必须遵守的约定：

1. **缺勤不淡化，改边不换面**。旧实现是 `opacity-60 saturate-50` 整卡压暗，与非本周课程的淡化色（见上表「非本周课」）观感雷同 —— 同一张课表上「缺勤」和「这周没这节课」几乎分不出来（用户反馈原话：「跟单双周但是这周没有这节课的显示效果一致」）。现在缺勤是**边缘信号**：卡片底色照旧、只把描边换成不透明红，与非本周的「整张卡换淡化色」在形状上就不同。红描边宽度仍取自 `--cc-ring`，**不为缺勤另起一套尺度**。
2. **「还没有标记」不等于「缺勤」**。没有标记、或只写了备注的格子一律中性：不淡化、无角标、`title` 也不写「未上」。旧实现只看 `!isAttended`（`undefined` 的 mark 也为真），会把整周没标记的格子全判成「未上」，这与看板「只写备注算未标记」的口径互相矛盾。

> **已评估但未做**（口径 B）：按真实时间过滤「还没到点的课次」（例如周一点了「全部未上」后，周五那节课不该显红）。需要 `firstWeekStartDate` 推算 + `deriveSectionTimes` 的节次时间 + 未来周 / 历史周行为定义 + 学期日期缺失时的回退，且同一格会在一天内变色（截图验收不稳定）。要做请另开任务。

---

## 课程格尺度体系（2026-09-25 起）

课表内容的字号、内边距、描边、圆角、角标尺寸**全部由课程格自身的尺寸推导**，单一真源在
`app/features/schedule/cellScale.ts`。改这里之前先读该文件的顶部注释。

**为什么要有这一层**：改动前字号是两套硬编码值（手机 `text-[10px]` / 桌面 `md:text-sm`），
唯一开关是 `useIsMobile()` 的视口布尔值，与格子尺寸零耦合；兜底还只是按 px 硬减两档
（`baseName = isMobile ? 10 : 14`，每档 −1px）。真机 360×794 实测同一个屏幕里出现
8 / 9 / 10 三种课名字号，其中 8 与 9 是**同一个 20 字课名**在不同格高下被硬减出来的。

### 查询容器结构

```
[data-schedule-grid]                     ← container-type: inline-size（表头 / 节次列靠它当查询容器）
  └ div[data-course-wrapper]             ← container-type: size，**无内边距、无边框**
        └ div（p-px + border-r/border-b）  ← 网格线与卡片内缩，逐格可能不同
              └ <button>
                    └ content span（justify-start，顶部对齐）
```

两条硬要求：

1. **容器必须挂在无内边距、无边框的那层**。`cq*` 解析的是查询容器的**内容盒**，而网格线与
   `p-px` 是逐格不同的（最后一列 / 最后一行不贴边线）——挂错层会让最后一列的容器盒宽 1px
   （约 2.5%），**同尺寸格子的字号立刻不一致**。
2. **网格自己也要当容器**。表头与节次列不在课程格内，若不设容器，它们的 `cqw` 会静默回退到
   小视口尺寸——很难发现的一类错误。

### 尺度变量（`--cc-*`）

全部由 `CELL_SCALE` 常量派生，声明在 `[data-schedule-grid]` 上并继承到每个课程格：

| 变量 | 含义 | 手机 360px 实际取值 |
| --- | --- | --- |
| `--cc-name-raw` | 课名**基础长度** = `min(24cqw, 30cqh)` | → 10.11px |
| `--cc-room-raw` | 教室 / 教师 / 备注 / 单双周基础长度 = `min(21.5cqw, 27cqh)` | → 9.06px |
| `--cc-pad-x` / `--cc-pad-y` | 横向 / 纵向内边距 | 3.4 / 3.7px（改动前固定 6 / 4px） |
| `--cc-ring` | 描边宽度 | 2px |
| `--cc-radius` / `--cc-badge` | 圆角 / 出勤角标尺寸 | 4.6 / 11px |
| `--cc-head` / `--cc-head-sub` / `--cc-section-no` / `--cc-section-time` / `--cc-month` | 表头、节次列字号（相对**网格**容器） | 11.1 / 8.5 / 13.1 / 8.5 / 9.8px |

**两条实现坑（都踩过，别改回去）**：

- **`var(--cc-scale)` 与 `clamp()` 必须写在使用处**（即元素自己的 `font-size`），不能塞进网格声明的
  自定义属性里。自定义属性中的 `var()` 是在**声明它的元素**上就完成替换的——写在网格上的
  `--cc-name` 会把网格上的 `--cc-scale`（不存在 → 回落 1）固化进去，课程格上后设的 `--cc-scale`
  永远不生效。`cqw` / `cqh` 相反（长度单位，按使用处的容器解析）。
- **字号类必须是字面量**。Tailwind 只扫描源文件里出现的字面类名，运行时拼出来的类名不会被生成——
  实测会静默回落到浏览器默认 `16px` / 行高 `1.5`。`cellScale.test.ts` 用常量拼出正则去 `toMatch`
  这两串类名，改一边就会失败。

### 字号公式与 15px 上限

```
font-size: clamp(8px, calc(clamp(8px, var(--cc-name-raw), 15px) * var(--cc-scale, 1)), 15px)
```

顺序是「**先钳到可读区间 → 再乘兜底档位 → 最后再夹一次**」。写成「先乘再钳上限」时，基础长度已经
超过上限的格子（大视口）缩放会被上限吃掉，兜底等于失效。

- **下限 8px** 是硬要求：任何尺寸、任何兜底档位都不会突破。
- **上限 15px** 是「缩放仍能揭示更多信息」的机理：1x→2x 列宽涨 2 倍而字号只涨 1.5 倍，多出来的
  宽度全部变成「每行更多字 → 更少行 → 腾出高度给教师 / 备注」。放开上限就退化成纯放大镜。
- 教室行恒比课名低一档（`21.5 / 24 ≈ 0.896`）。**在两侧都未被上下限截断的区间内比值恒定**；
  任一侧触底或触顶时比例必然被截断——这是物理事实，不是缺陷。

### 已知取舍（真机口径，别当 bug 修）

1. **1 节矮格（62px 行高）× 超长课名（20 字）在物理上无解**：既想保 8px 可读字号、又想完整显示
   20 个字，二者不可能同时成立。取舍是 **不截断、不丢行，让内容向下溢出被卡片裁剪**；字号不低于
   8px，且**绝不水平溢出**。真机与新夹具都在这个格型上复现过。
2. **兜底是内容驱动的**：同一尺寸下「20 字课名」可以比「4 字课名」小一档。这是设计（按最小必要
   缩幅保证放得下），不是「同屏落差」。同屏一致性的准确表述是
   **「同尺寸 + 同兜底档位 ⇒ 同字号」**。
3. **桌面端课名字号封顶 15px**，超宽屏下列宽会有富余（宁可留白，也不让字大到荒谬）。

### 兜底：相对比例，不是 px 硬减

`CELL_FALLBACK_SCALES = [0.95, 0.9, 0.85, 0.8, 0.75]`，取「**刚好放得下的第一个档位**」；
缩到下限仍放不下就停手，接受上面第 1 条。**粒度必须是 0.05**：档位越粗，缩幅越可能远超实际需要，
而超出的缩幅会直接变成用户看到的「同屏字号落差」。实测 412px 视口下 20 字课名在 0.05 粒度落到
0.95（缩 5%，几乎看不出），在 0.1 粒度会一路掉到 0.8（缩 20%）。

全量实现细节见 `app/features/schedule/cellScale.ts` 与
`.trellis/tasks/archive/2026-09/09-24-schedule-responsive-sizing/design.md`。

---

## Zoom Tiers and Information Levels

```ts
export const ZOOM_TIERS = [1, 1.5, 2] as const
export function getDetailLevel(zoom: number): 'compact' | 'standard' | 'full'
```

- **缩放只改列宽，不引入任何等比缩放**（不用 CSS `zoom`、不用 `transform: scale`）。
- **字号由格子尺寸推导**（见「课程格尺度体系」）：列变宽 → 字号也涨，但**封顶 15px**。1x→2x 列宽涨 2 倍而字号只涨 1.5 倍，多出来的宽度全部变成「每行更多字 → 更少行 → 腾出的行高容纳教师/备注」。若把上限一起放开，2x 就退化成纯放大镜——这是明确禁止的。
- 档位（`compact` / `standard` / `full`）仍是离散吸附：`snapZoomTier` 在 <1.35 → `compact`、<1.9 → `standard`、其余 `full`。但**档位不再驱动内容显隐**（2026-09-24 起）：显示到哪一级由下面的「空间自适应」实测决定，档位只作为 `data-zoom-tier` 这类观测锚点保留。
- 缩放值不持久化，进页面固定 1x：避免用户上次放大后误以为课表只有三天。

## 空间自适应（内容显隐怎么决定）

**不要**用高度阈值（`[@container(min-height:…)]:` 之类）决定教师/备注显隐：Tailwind v4 不支持高度条件任意变体，生成的 CSS 里根本没有 `@container` 规则，等于这些行永远不显示；而且同一个高度下，20 字课名要占 7 行、3 字课名只占 1 行，阈值本身也区分不出来。

`ScheduleCourseCell.tsx` 的实际做法是在 `useLayoutEffect` 里**实测一次**内容高度，按优先级逐级丢弃：

1. 先把可选的两行（教师、备注）置为 `display: block`（它们在 class 上是 `hidden`，无 JS 时保持保守态）；单双周标签不参与这一步——它的可见性由 CSS 断点决定（`block md:hidden`）。
2. 若溢出，按 **备注 → 教师 → 单双周标签** 的顺序把整行设为 `display: none`，每丢一行重新判断，直到放得下；
3. 丢完仍放不下（典型场景：只有一节的矮格子遇上超长课名）则进入兜底：按 `CELL_FALLBACK_SCALES` 逐档乘 `--cc-scale`（**相对比例，不是 px 硬减**），课名与教室同步缩，保持行间层级。

**判据里没有任何视口布尔值**：早期实现用 `isMobile` 决定「这个格子是不是窄格子」，那是错的——窄不窄由格子自己说了算。

实现约定：

- 直接写 `style.display` 与 `--cc-scale`，**不要** setState —— 测量与渲染不会互相触发，也不会每格多渲染一次。
- 每轮 apply 先清掉上一轮的内联覆盖（`display` 与 `--cc-scale` 都要清）。单双周标签的桌面端隐藏靠 CSS 的 `md:hidden`——**内联样式会压过它**，所以只在空间不够时写 `display: none`，绝不在手机端把它写成 `display: block`。
- 依赖 `ResizeObserver` 观察**外层格子按钮**（尺寸由网格与缩放决定，内容变化不会改动它）来在缩放 / 旋屏 / 窗口变化后重测；观察内容元素本身会因为自身尺寸变化互相触发。
- 实测口径：`content.scrollHeight <= content.clientHeight + 1`（1px 亚像素容差）。
- **首帧一次测量不够**：挂载那一刻网格行高还没被 `1fr` 分配定稿（量到的是内容自然高 → 误判「放得下」），中文字体也可能晚到改变换行——两者都不会触发按钮尺寸变化，`ResizeObserver` 不会补跑。因此 `apply()` 之后必须在 `requestAnimationFrame` 与 `document.fonts.ready` 各补测一次（否则长课名格溢出被裁）。
- **水平**居中：每轮实测「最长行宽」，把内层块 `style.width` 设为 `min(该宽度, 100%)`，外层 `items-center` 负责居中；收窄后若高度或宽度任一不满足则把宽度还原成整宽，**宁可偏左也不裁字**。**必须夹 `100%`**：`overflow-wrap: break-word` 不降低 min-content，`(Python)` 这类不可断 token 的 min-content 可能比内边距盒还宽，不夹就会把块撑出卡片、压到描边上。
- **垂直**顶部对齐（`justify-start`），**不做垂直居中**：1 行内容的格子与 7 行内容的格子必须从同一条顶边起排，否则同一屏里每格的起始高度都不一样。超长内容向下溢出被卡片裁剪，顶部始终可见。

---

## 可选开关：收起整周无课的日期列（2026-09-25 起）

`useScheduleDisplayStore` 的 `collapseEmptyWeekdayColumns`，持久化 key `class-track-schedule-display`，
设置项在个人中心「课表显示」卡片里。**默认关闭**。

- **判定用 `visibleCourses` 而不是 `classes`**：开启「淡化显示非本周课程」时非本周课也占格，
  那一列就不算「整周无课」。
- **全周都没课时不折叠**（`busyDays.size > 0 && busyDays.size < 7`）：没有任何一列可以把宽度让出去。
- 列模板走**内联样式**（要逐列不同 + 带 `minmax` 下限），因此节次列的 `2rem` / `4rem` 也只能由 JS 给——
  内联的 `grid-template-columns` 会整体覆盖 class 上的断点版本。**关闭开关时必须回落到 class 版本**
  （与改动前的 `grid-template-columns` 逐字符一致）。
- 收窄列是 `minmax(1.75rem, 0.45fr)`：`1.75rem` 是**最小列宽保护**，保证「周六 + 10.03」两段文案仍放得下。
- **既知代价**：列宽随当前展示周变化（翻周时列宽会跳动）。这是可选功能的固有行为，已写进设置项说明文案。

---

## 可选开关：左右边缘滑动切换周（2026-09-29 起）

`useScheduleDisplayStore` 的 `edgeSwipeWeekSwitch`，持久化 key `class-track-schedule-display`，
设置项在个人中心「课表显示」卡片里。**默认开启**（它是「滑到边缘才有反应」的补强手势，不占用任何既有交互）。

- **只在手机端生效**：`enabled = isMobile && edgeSwipeWeekSwitch`；桌面端连监听器都不挂。
- 关掉后横滑完全回到改动前的行为：无位移、不切周、`data-week-swipe-state` 属性不存在。
- 边界（第 1 周 / 第 `maxWeek` 周方向）**仍然给阻尼位移**（有「到头了」的反馈），只是松手不切周 ——
  与顶栏翻周按钮的禁用态语义一致。
- 开关的初始值 / `partialize` / `merge` 三处必须同步维护，漏一处会在「旧数据 + 新增字段」时静默丢值。
- 手势契约见下方 Gesture Implementation 的「横向轴的边缘阻尼手势」一节。
---

## Gesture Implementation

`useScheduleZoom()` 的约定：

- 手势期间**不 setState**：直接写 `--schedule-zoom` CSS 变量（只触发样式重算），并按捏合中心补偿 `scrollLeft`；松手才 `setZoom(snapZoomTier(...))` 提交一次，避免每帧重渲染 7×12 网格。
- 只改宽度的实现依赖 `min-width: calc(100% * var(--schedule-zoom))`：`var` 为 1 时恰好不溢出，这是「1x 无横向滚动」的机理，下界必须精确等于 1（`ZOOM_MIN`）。
- 滚容器必须有 `[touch-action:pan-x_pan-y]`：排除 WebView 自带的 pinch-zoom，同时保留单指滚动。
- 双指手势外，触摸端的双击用两次 `pointerup` 的间隔与位移自行判定（部分 WebView 不派发 `dblclick`）；鼠标走 `onDoubleClick`。
- `setPointerCapture` 必须包 try/catch：合成的 pointer 事件（自动化断言）没有真实指针，捕获会抛异常，但不影响手势本身。
- **双击切换必须去抖**：Android WebView 实测会在第二次抬起后同时派发我们自己的 `pointerup` 判定与浏览器合成的 `dblclick`，两条都触发就会切换两次、相互抵消（表现为“双击没反应”）。`toggleZoom` 用 400ms 窗口内的第二次调用直接返回。
- 缩放控件用 `isMobile &&` 条件渲染而不是 `md:hidden`：桌面端要求“不渲染”（见 PRD D6），仅靠 CSS 隐藏会让 `document.querySelector('[data-schedule-zoom-control]')` 仍然命中。

### 横向轴的边缘阻尼手势（`useWeekSwipeGesture`，2026-09-29 起）

`app/features/schedule/hooks/useWeekSwipeGesture.ts`（DOM 层）+ `app/features/schedule/weekSwipe.ts`（纯函数核：
全部数值与判据的唯一真源，因此可在 node 环境的 vitest 里钉死 —— DOM 手势本身没法单测）：

- **只观测、不拦截**：`touchstart` / `touchmove` / `touchend` / `touchcancel` 全部 `{ passive: true }`，任何路径
  都不 `preventDefault` —— 纵向滚动、课程格点按、双指与双击缩放都不受影响。
- **用 touch 而不是 pointer**：触摸横滑时浏览器会给 pointer 序列发 `pointercancel`（**即使该方向根本不能
  滚动也会发**），pointer 拿不到可用位移；被动 `touchmove` 在原生滚动期间照常派发。**这是本手势成立的前提**，
  改成 pointer 会立刻坏掉。
- **只用横向轴**：第一次越过 `SWIPE_AXIS_SLOP_PX`（12px）时定轴；纵向手势全程不碰 DOM。
- **位移落在滚动容器自身**（`[data-schedule-scroll]`），**不是**内层网格：被 transform 的后代会计入滚动溢出区域，
  写在内层会实时污染 `scrollWidth`，让边缘判定自己失效。外层新增的 `[data-schedule-swipe-stage]`
  （`flex min-h-0 flex-1 flex-col overflow-hidden`）只负责裁剪，两层尺寸分配与改动前等价（有基线数字可比）。
- **互斥规则（核心）**：每帧用 `resolveScrollEdges` + `sideAllowsRubber(edges, step)` 判定；**不允许阻尼时
  重锚 + 位移归零**，把横向轴让给原生滚动。于是缩放态下是「先正常滚动，滚到该方向边缘后继续同向拖才出现
  阻尼」；从边缘往回拖时原生滚动立刻接管（重锚），不会出现「原生滚动 + 阻尼位移」的双重位移；`scrollLeft`
  因合成器滚动滞后时也只会「晚一两帧出现阻尼」，不会闪。
- **阻尼与松手判据**：有界橡皮筋 `RUBBER_MAX_PX = 96`（82px 手指位移达到 `SWITCH_DISTANCE_PX = 44`），
  另有快甩判据 `SWITCH_VELOCITY_PX_PER_MS = 0.6`（只认朝目标周方向的速度，反向甩动不算）。
- **切周动画**（不预渲染相邻周）：滑出 110ms（沿手指方向 + 淡到 0.35）→ 换内容并把位移瞬时放到**对侧** →
  双帧后滑入 170ms 回到 0。两段方向必须相反，否则是「反向弹回」。`prefers-reduced-motion: reduce` 时直接换周、
  不做过渡。
- **拖动期间不 setState**：只写内联 `transform` / `opacity`，切周只提交一次 `onWeekChange`（实测拖动 0 次
  React commit、切周 1 次）。
- **清理只有一个入口**：`reset()` 清掉 `transform` / `opacity` / `transition` 三个内联值（**不是**写
  `translate3d(0px,0,0)`），被回弹结束、切周结束、`touchcancel`、第二根手指出现、`enabled` 变假、卸载、外部改周
  全部复用。
- **配套修掉的旧缺陷**：`pointercancel` 不再参与双击判定，且 `pointerup` 还要过「按下点 → 抬起点」的位移校验
  （`isTapSizedMove`，容差 `TAP_MOVE_TOLERANCE_PX` 与手势层同源）。否则连续两次横滑会被判成双击、缩放档位来回切换。

**在模拟器上验证触控**（真机行为只有真机才验得出来）：

```bash
# 1) 打开 App 后取 WebView 的 devtools socket 并转发（App 重启后 socket 名会变）
SOCK=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote[^ ]*' | head -1 | tr -d '\r')
adb forward tcp:9222 localabstract:$SOCK
# 2) 用 CDP 灌 localStorage（复用 research/seed-schedule-fixture.js）后 Page.reload
# 3) 用 CDP Input.dispatchTouchEvent 派发双指手势；用 adb shell input tap 验证真实点按
#    注意 adb input tap 用的是设备像素：CSS px × devicePixelRatio（Medium_Phone 上是 2.625）
```


---

## Section Time Derivation

解析数据只有块级时间（`KSSJ`/`JSSJ` 对应 `KSJC → JSJC`），没有单节作息表：

```ts
export function deriveSectionTimes(classes: Class[]): Record<number, SectionTime>
```

- 单节课程同时贡献该节的 `start` 与 `end`；跨节课程只在首节贡献 `start`、末节贡献 `end`。
- 同一节次多候选取众数，票数相同取字典序最小 —— 结果与课程数据顺序无关。
- **输入用整个学期的 `classes`**（在 `SchedulePage` 里 memo），而不是仅本周的课程，这样只在其他周出现的节次也有时间。
- 已知限制：2 节块的节中空档（如 `08:45`/`08:55`）无法还原，节次列只显示可推导的起止点，不显示时段文案不存在的节次留空行。

---

## Test Hooks

自动化验证依赖这些属性，**不要静默移除**（用属性定位，不要用中文文案或 `:nth-child`，文案会改写、列顺序会被响应式调整）：

| 属性 | 位置 | 用途 |
| --- | --- | --- |
| `data-schedule-scroll` | 课表滚动容器 | `scrollWidth === clientWidth` 判定无横向滚动；`containerProps` 挂在它上面 |
| `data-schedule-grid` | 内层网格 | 读 `min-width` 计算值、定位网格 |
| `data-zoom-level` / `data-zoom-tier` | 内层网格 | 当前档位与信息分级 |
| `data-day-head` | 日期表头单元格 | 读列宽、确认 7 列都在视口内 |
| `data-section-row` | 节次行单元格 | 读节号与时间文案 |
| `data-course-cell` | 课程块按钮 | 点击回归、读字号是否随缩放变化 |
| `data-course-name` | 课名元素 | `textContent` 完整且 `webkit-line-clamp: none`；读 computed `font-size` / `line-height` |
| `data-course-room` | 教室元素 | 断言「教室恒显、不被丢弃、不水平溢出」 |
| `data-course-teacher` | 教师元素 | 丢弃顺序守卫（教师可见 ⇒ 课名/教室可见） |
| `data-course-note` | 备注元素 | 丢弃顺序守卫（备注可见 ⇒ 教师可见） |
| `data-course-wrapper` | 课程格的**查询容器**（网格项那层无内边距/无边框的 div） | 读 `clientWidth`/`clientHeight` 复算字号、按「容器宽 × 行跨度」分组 |
| `data-course-parity` | 单双周徽标 | 1x 可见、桌面端 `display: none`（由 CSS 断点决定，不是「不在 DOM 里」） |
| `data-course-out-of-week` | 非本周课程块 | 判定「淡化显示非本周课程」是否生效、灰色态是否渲染 |
| `data-schedule-zoom-control` | 缩放浮层 | 手机端在、桌面端不在 DOM |
| `data-schedule-swipe-stage` | 滚容器的外层裁剪层 | 定位 stage；确认尺寸分配由「stage + 滚容器」两层承担、数字与改动前一致 |
| `data-week-swipe-state` | 滚容器（**命令式写，不在 React 树里**） | `'idle'` \| `'dragging'` \| `'switching'`；开关关闭或未启用时该属性不存在 |
| `data-current-week` | 顶栏「第 N 周」span | 断言切周是否发生、切到哪一周（不依赖中文文案） |

---

## Verification Recipe

```bash
export XDG_RUNTIME_DIR=/tmp/claude/ab-runtime   # /run/user/1000 是 ro 挂载，agent-browser 建不了 socket
mkdir -p "$XDG_RUNTIME_DIR" /tmp/claude          # TMPDIR=/tmp/claude 不存在时 pnpm 直接崩
pnpm dev &                                       # 后台进程不能跨 bash 调用存活，必须与浏览器操作同一次调用
agent-browser open http://localhost:5173/
agent-browser set viewport 412 915 2
# 写入种子数据后必须重新 open（zustand persist 只在模块初始化时读取）
# 种子数据走 storage 通道并紧跟 reload：直接 eval 写 localStorage 会被已启动的 app 回写覆盖
SEED=.trellis/tasks/archive/2026-09/09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js
node -e 'const fs=require("fs");const s={};new Function("localStorage",fs.readFileSync(process.argv[1],"utf8"))({setItem:(k,v)=>s[k]=String(v),getItem:()=>null});fs.writeFileSync("/tmp/claude/seed.json",s["class-track-storage"])' $SEED
agent-browser storage local set class-track-storage "$(cat /tmp/claude/seed.json)"
agent-browser reload
# dev server 首次访问按需编译，必须轮询等 [data-course-cell] 出现再断言
agent-browser eval "String(document.querySelectorAll('[data-course-cell]').length)"
```

`agent-browser eval` 只可靠返回字符串：返回对象会显示成 `null`，断言脚本必须以 `JSON.stringify(...)` 结尾。

### 课表尺度的一键验收（2026-09-25 起）

`.trellis/tasks/archive/2026-09/09-24-schedule-responsive-sizing/research/`下有两份可复用工具：

- `browser-probe.js` —— 取数探针（返回 JSON 字符串），采「容器内容盒尺寸 / 每个文字元素的
  `scrollWidth` 与 `clientWidth` / 各行的 computed 字号与行高 / 内容块顶部偏移」；
- `verify-responsive-sizing.mjs` —— 遍历视口 × 场景断言全部尺度 AC，支持 `--only a|bcdef` 分段跑
  （单次 bash 调用跑不完全量），报告**合并写入**同一个 `--out` 文件。

**`storage local set` 之后必须立刻 `reload`，中间不能夹任何命令**（包括 `set viewport`）：
上一页实例会抢在 reload 前把自己的内存状态回写进 localStorage，把刚写进去的夹具覆盖掉——
表现是 reload 后 `cells=0`、落到空状态页。`openAt()` 把这一步做成了原子操作并带重试。
 `openAt()` 把这一步做成了原子操作并带重试。

### 触摸手势的一键验收（2026-09-29 起）

`.trellis/tasks/archive/2026-09/09-29-schedule-edge-swipe-week-switch/research/cdp-touch-swipe.mjs`：
用 CDP `Input.dispatchTouchEvent` 派发真实触摸序列（不是构造 `TouchEvent` 对象），四种模式：
`full`（8 组场景）/ `off`（开关关闭时横滑无位移）/ `shot`（按住不放截图）/ `drag1 <fromX> <toX> <steps>`（单次拖动，便于外部夹住 `agent-browser react renders start|stop` 计数）。

- 连接要用**page** target 的 `webSocketDebuggerUrl`（`agent-browser get cdp-url` 给的是 browser target，调 `Runtime.evaluate` 会报 `-32601`）。
- `XDG_RUNTIME_DIR` 默认指向只读的 `/run/user/1000`，先 `export XDG_RUNTIME_DIR=/tmp/ab-runtime`；**不要把它与 `pnpm dev &` 写在同一条 `&&` 链里**（整条链会被 `&` 放进子 shell，export 不生效，报 `Failed to create socket directory: Read-only file system`）。
- dev server 不能跨 bash 调用存活（每次调用是新的 net/pid 命名空间）：起服务、灌种子、跑脚本必须在**同一次**调用内完成。
- 断言只看 `data-*` 与 computed style：拖动中读 `inlineTransform` / `data-week-swipe-state`，松手后读 `data-current-week` 与 `inlineTransform === ''`；关掉动画残留的判据是 `computedTransform === 'none'`（不是 matrix 全零）。

### 视口高度锚点的等价条件验收（2026-09-29 起）

`.trellis/tasks/09-29-fix-schedule-scroll-legacy-webview/research/`：

- `cdp-dvh-equivalent.mjs` —— 把页面里所有 `height: 100dvh` 声明从 CSSOM 里 `removeProperty` 掉
  （= 旧引擎忽略该声明后的结果，不删整条规则，所以 `overflow:hidden` 等仍然生效），再读 `html/body`
  计算高度、`[data-schedule-scroll]` 的 `maxScrollTop`，并用 CDP 真实触摸派发一次纵向拖动。
  **这是「课表能不能上下滑」唯一的自动化判据**：兜底失效时这里会得到 `maxScrollTop = 0`、拖动后 `scrollTop` 不动。
- `cdp-dvh-simulation.mjs` —— 更粗的对照（直接 `height:auto !important`），展示「连兜底都没有」时的后果。
- `cdp-vertical-scroll-matrix.mjs` —— 412/360 × 7 个视口高度的纵向滚动对照组（支持 `dvh` 时本来就该正常）。
- `lightningcss-fallback-matrix.mjs` —— 兜底写法矩阵：用仓库实际那份 lightningcss 编译候选写法，断言
  兜底是否活到产物里；升级 Tailwind / Vite / lightningcss 之后怀疑兜底又被删时，先跑它。
- `make-seed.mjs` —— 由归档夹具生成 `--init-script` 用的灌种子脚本（夹具里的中文与双引号经
  `agent-browser eval "$(cat …)"` 会被 shell 吃掉转义，写不进去）。
- `preventive-hardening-probe.mjs` —— 加固候选矩阵（基线 / 网格 `min-height` / 外壳锚点 / 锚点被人为拿掉 / 各组合），
  每个场景都做一次真实触摸纵向拖动，用来同时验「正常引擎零影响」与「失效时可救援」。
- `device-diagnostics.mjs` —— **设备侧一键诊断**：`--print-snippet` 打印可贴进 WebView devtools 的自包含表达式，
  给 CDP ws url 则直接输出判定（`ok` / `needs-no-scroll` / `layout-anchor` / `scroll-disabled` / `touch-layer`）。
  遇到「滑不动」先用它定位到层，别直接改 CSS。
---

## Common Mistakes

- 把手机端的 `min-w-[760px]` 加回来（哪怕只在某个断点）：1x 立刻失去整周可见。
- 给手机端课名加 `line-clamp-*`：这是本次专门去掉的截断。
- 用 `sm:` 而不是 `md:` 写移动优先类：与 `useIsMobile()` 的 768px 边界割裂。
- 在 `zoom` 状态下每帧 `setState`，或在手势里用 React state 驱动 `--schedule-zoom`：WebView 掉帧。
- 把节次时间渲染进课程块：用户明确要求时间只在最左列。
- 用 `textContent.includes('课程名')` 定位课程块做断言：课程名会被改写，应改用 `data-course-*` 属性。
- 用高度阈值（容器查询类）决定教师/备注显隐：Tailwind v4 不生成 `@container` 规则，表现为「教师与备注永不出现」（桌面端干净加载时最明显）。
- 把课名或教室放进可丢弃序列换空间：这两行是硬要求，只能丢别的行、或走兜底缩字号。
- 用 `agent-browser eval` 直接写 localStorage 灌种子数据：正在运行的应用会把它的内存状态回写覆盖，必须先 `storage local set` 再 `reload`。
- `agent-browser open` 的 `--init-script` 只在**启动浏览器那一次**生效：`set viewport` / 先 `open` 不带 flag 都会提前启动浏览器，之后再加 flag 一律被忽略。
- 课表配色迭代四连坑（2026-09-24 真机连续反馈）：① Tailwind `400→500` 高饱和渐变太艳；② 换参考图中间调后白字小行在浅底上糊、且相近色相（深绿/浅绿）分不清；③ pastel 浅底 + 同色相 700 深色课名被否（课名要纯白）；④ 文字阴影显脏被否。**定稿：平色中间调（无渐变）+ 纯白字 + 色相间隔 ≥30°**。
- 有课程的格子不贴网格线会让整表「线断断续续」：课程格容器必须与空格一样贴 `border-r`/`border-b`，课程卡靠 `p-px` 内缩进线格，而不是省略边线。
- 用 `text-center` 给课名逐行居中：长课名每行都居中会左右跳动、更难读。要的是**块居中 + 块内左对齐**（收窄内层块宽度，由外层居中）。
- 用纯白内描边（`ring-white` / `ring-white ring-inset`）做「参考图同款白边」：白底页面上看不出是描边，只会觉得卡片被缩小了 2px。必须用**半透明白**（`ring-white/55`），让描边压在卡片色上成一层浅色边。
- 自己推配色（HSL 调亮度 / 加灰罩 / 加遮罩层）：真机口径是「照参考图逐像素采样」。HSL 取色会出现黄亮紫暗；DOM 遮罩会把白字一起压灰。**正确做法：对参考图卡片做连通域采样取中位色，直接用采样 hex（平色、无渐变）**。
- 用 `break-all` 处理课名/教室：会把数字与拉丁词切断（`28-A20` / `3`、`Pyth` / `on`）。课名与教室都用 `break-words`。
- 加完上下内边距后不动脑子上线：内容高度预算是固定的，`py` 每加 2px 就可能让 24 字超长课名格掉进「缩字号」兜底——改完必须复测缩档计数。
- 给课表内容写 `text-[<数字>px]`：课表是唯一需要「整周一次看全」的页面，固定 px 字号会在任何显示尺寸变化下失配。字号只能来自 `--cc-*`；`scheduleSourceGuard.test.ts` 会扫整个目录拦下来。
- 在 `app/features/schedule/**` 里写 `sm:`：与 `useIsMobile()` 的 768px 边界割裂（同上守卫会拦）。
- 把课程格的查询容器挂在带 `border-r` / `p-px` 的那层：容器内容盒会随「这是不是最后一列」变化 ~2.5%，同尺寸格子字号立刻不一致。容器必须是网格项那层**无内边距、无边框**的 div。
- 把 `var(--cc-scale)` 或 `clamp()` 写进网格声明的自定义属性：自定义属性里的 `var()` 在**声明处**就替换掉了，课程格上后设的 `--cc-scale` 永远进不来（实测 scale=0.8 时字号完全没缩）。缩放与钳位必须写在使用处。
- 运行时拼接 Tailwind 类名（哪怕数值与常量同源）：Tailwind 只扫字面量，拼出来的类不会生成规则，computed 字号会静默回落到浏览器默认 16px。类名写成字面量，用单测的形状断言保证与常量一致。
- 把课程格内容改回垂直居中：1 行内容的格子会浮在中间、7 行内容的会贴着顶部，同一屏里每格起始高度都不一样。要**顶部对齐**（`justify-start`）。
- 把兜底阶梯的粒度调粗（0.1 甚至两档）：缩幅会远超实际需要，超出的部分直接变成用户看到的「同屏字号落差」。粒度 0.05，取「刚好放得下的第一档」。
- 把 `--cc-scale` 的缩放写成「先乘后钳上限」：基础长度已超上限的格子缩放会被上限吃掉，兜底等于失效。必须「先钳 → 再乘 → 再夹」。
- 把边缘阻尼的位移写在**内层网格**上：被 transform 的后代会计入滚动溢出区域，`scrollWidth` 会被自己实时改大，于是 `resolveScrollEdges` 判定被污染（1x 的「两侧都允许」会自己失效）、还可能凭空长出滚动条。位移必须写在滚容器自身，由外层 `overflow-hidden` 裁剪。
- 用 **pointer 事件**做横滑跟手：触摸横滑时浏览器会给 pointer 序列发 `pointercancel`（该方向根本不能滚动也会发），`pointerup` 的坐标是「取消点」而不是手指真实位置 → 位移全丢、双击还会被误判。手势只能靠被动 `touchmove` 观测。
- 在手势里 `preventDefault()`：触摸序列里第一个 `touchmove` 没有 `preventDefault` 就会被当成被动，之后再拦已经无效；而且一旦拦截，纵向滚动与课程格点按都会被牵连。本手势的实现是**只观测不拦截**。
- 复位时写 `translate3d(0px, 0, 0)` 而不清空内联值：会留下「有 transform」的残留状态（`getComputedStyle` 返回 matrix 而不是 `none`），自动化判据与后续手势的起点都会被误导。`reset()` 必须把 `transform` / `opacity` / `transition` 三个内联值都清空。
- 让 `pointercancel` 参与双击判定（或只看两次抬起点的距离）：连续两次横滑会被判成双击、缩放档位来回切换。除了不让 cancel 参与，`pointerup` 还要过「按下点 → 抬起点」的位移校验。
- 拖动期间用 React state 驱动位移（`setTranslateX`）：7×12 网格会每帧重渲染。跟手阶段只写 DOM 内联样式，松手才提交一次周次。
