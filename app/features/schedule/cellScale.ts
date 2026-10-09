import type { CSSProperties } from 'react'

/**
 * 课程格尺度体系：**单一真源**。
 *
 * 背景（见任务 `09-24-schedule-responsive-sizing` 的 `design.md` §3 与 `research/real-device-analysis.md`）：
 * 改动前课程格字号是两套硬编码值（手机 `text-[<数字>px]` / 桌面 `md:text-sm`），唯一开关是
 * `useIsMobile()` 的视口布尔值，**与格子自身的尺寸零耦合**。于是任何显示尺寸变化都
 * 只能把固定的字塞进变化后的格子：真机 360×794 上实测同屏出现 10.0px 与 8.0px 两种
 * 字号（行距落差 1.27×），而兜底还只是按 px 硬减、判据是视口。
 *
 * 现在改为：**字号 = f(课程格容器自身的尺寸)**，由 CSS 容器查询单位直接算出来。
 * 这里只放常量与「CSS 字符串 ↔ JS 参考实现」的换算，两个消费者共用同一批数字，
 * 不会漂移：
 *
 * - `cellScaleStyle`：挂到 `[data-schedule-grid]` 上的静态自定义属性（会继承到每个课程格）；
 * - `resolveCellScale()`：同一公式的可执行版本，供单测与浏览器验收断言「CSS 实际值 == 预测值」。
 *
 * 单位约定：`cqw` / `cqh` 解析的是**最近查询容器的内容盒**。课程格的容器是网格项外层那个
 * 无内边距、无边框的 div（`CELL_CONTAINER_CLASS`），因此内容盒恰好等于网格给它的那块区域——
 * 这正是「同尺寸必然同字号」的机理：容器盒不再被 `border-r` / `p-px` 这类逐格不同的装饰影响。
 *
 * 注意：自定义属性是不解析的 token，`cq` 单位不会被声明处（grid）提前解析，而是在
 * **使用处**（课程格里的元素）按该元素最近的容器解析。这是整套设计的地基，
 * 由验收脚本的「CSS 实际值 == resolveCellScale()」断言钉住。
 */
export type ScaleSpec = {
  /** 容器内容盒宽度的百分数（`cqw`）。 */
  cqw?: number
  /** 容器内容盒高度的百分数（`cqh`）。 */
  cqh?: number
  /** 可读性下限（px）：任何尺寸、任何兜底档位都不会低于它。 */
  min: number
  /** 上限（px）：防止大屏 / 2x 缩放下文字被放大到荒谬的程度。 */
  max: number
}

/**
 * 尺度常量。
 *
 * 取值口径（360 CSS px 视口下，容器内容盒宽约 39px、1 节格高约 59px、2 节格高约 119px）：
 * 各量在该尺寸下与改动前的视觉**基本平价**，但从此随格子尺寸连续变化。
 */
export const CELL_SCALE = {
  /** 横向内边距：手机上从 6px 降到 ~3.1px——省下的宽度直接还给文字（可用文字宽 +18%）。 */
  padX: { cqw: 8, min: 2, max: 6 },
  /** 纵向内边距。 */
  padY: { cqh: 6, min: 2, max: 8 },
  /**
   * 课名：`min(24cqw, 30cqh)` 取「宽度允许」与「高度允许」的较小者——
   * `cqh` 项专门兜住「又宽又矮」的格子（例如桌面端 1 节格），防止字号大到一行都放不下。
   * 上限 15px 是「缩放仍能揭示更多信息」的机理：1x→2x 列宽涨 2 倍而字号只涨 1.5 倍，
   * 多出来的宽度全部变成「每行更多字 → 更少行 → 腾出高度给教师/备注」；上限跟着无限涨
   * 就退化成了纯放大镜（规格明确禁止）。
   */
  name: { cqw: 24, cqh: 30, min: 8, max: 15 },
  /** 教室 / 教师 / 备注 / 单双周：比课名小一档，比值约 0.89（与改动前 10/9 对齐）。 */
  room: { cqw: 21.5, cqh: 27, min: 8, max: 12 },
  /** 卡片白色描边宽度：改动前固定 `ring-2`，在 42px 宽的卡上占 4.8%，在桌面 190px 卡上只占 1%。 */
  ring: { cqw: 4.8, min: 1, max: 2 },
  /** 出勤角标（已上打勾 / 未上警示）：改动前固定 `size-3`，占列宽 27%，偏大。 */
  badge: { cqw: 26, min: 10, max: 16 },
  /** 卡片圆角。 */
  radius: { cqw: 11, min: 3, max: 8 },

  // ↓ 以下四项的容器是**网格**（`GRID_CONTAINER_CLASS`），不是课程格：
  //   表头行与节次列不在课程格内，靠网格当容器才能拿到有意义的宽度。
  /** 日期表头「周几」。 */
  head: { cqw: 3.4, min: 9, max: 12 },
  /** 日期表头「MM.dd」。 */
  headSub: { cqw: 2.6, min: 8, max: 10 },
  /** 节次号。 */
  sectionNo: { cqw: 4, min: 11, max: 14 },
  /** 节次时间（HH:mm）。 */
  sectionTime: { cqw: 2.6, min: 8, max: 10 },
  /** 节次列表头「9月」。 */
  month: { cqw: 3, min: 9, max: 12 },
} as const satisfies Record<string, ScaleSpec>

export type CellScaleKey = keyof typeof CELL_SCALE

/**
 * 参与兜底缩放的键：**只有字号**按 `--cc-scale` 等比递减。
 * 几何量（内边距、描边、圆角、角标）不缩——它们本来就是随容器走的，再缩会破框。
 *
 * 类型写成字面量元组（而不是 `readonly CellScaleKey[]`）是有意的：`CELL_FONT_CLASS` 只有
 * 这两个键，用宽类型索引它会**通不过类型检查**；需要按 `CellScaleKey` 判定的地方请用
 * `SCALED_KEY_SET`。
 */
export const CELL_SCALED_KEYS = ['name', 'room'] as const

/** `CELL_SCALED_KEYS` 的集合形态，供需要按 `CellScaleKey` 判定的地方使用。 */
export const SCALED_KEY_SET: ReadonlySet<CellScaleKey> = new Set(CELL_SCALED_KEYS)

/**
 * 唯一的行高系数（PRD A5）。
 *
 * 改动前课名行高有两个值：class 里的 `leading-[1.2]` 与兜底写入的内联 `1.05`，
 * 同一个格子换个尺寸就在这两个值之间跳，把字号落差进一步放大。现在正常态与兜底态
 * 共用同一组系数，兜底只改字号、不再动行高。
 */
export const CELL_LINE_HEIGHT = { name: 1.15, room: 1.2 } as const

/**
 * 兜底的相对缩放阶梯（PRD A7）。
 *
 * 改动前是 `baseName = isMobile ? 10 : 14` 每档 `-1px`、最多两档（压到 8px / 7px）。
 * 现在只按基准字号的**相对比例**递减，且 CSS 侧 `clamp` 的第一位就是硬下限，
 * 所以缩到底也不会突破下限——缩到下限仍放不下就停手，接受已确认的已知限制
 * （1 节矮格 + 超长课名的物理极限，见规格 `mobile-schedule-layout.md`）。
 *
 * **粒度取 0.05 而不是 0.1**（对 design.md 的偏离，实测驱动）：兜底会按下面的顺序取
 * 「**刚好放得下**的第一个档位」，档位越粗，缩幅就越可能远超实际需要，而超出的缩幅会直接
 * 变成用户看到的「同屏字号落差」——正是本次要修的症状。浏览器实测：412 CSS px 视口下
 * 20 字课名在 0.05 粒度上落在 0.95（缩 5%，几乎看不出），在 0.1 粒度上会一路掉到 0.8（缩 20%）。
 * 代价是每格最多多 3 次 reflow（只在需要缩的格子上，且同一帧内完成、不会画出中间态）。
 */
export const CELL_FALLBACK_SCALES = [0.95, 0.9, 0.85, 0.8, 0.75] as const

/** 网格的查询容器类：表头 / 节次列的 `cqw` 需要它当最近的查询容器（否则会静默回退到视口尺寸）。 */
export const GRID_CONTAINER_CLASS = '[container-type:inline-size]'

/**
 * 课程格的查询容器类。
 *
 * 必须挂在**无内边距、无边框**的那层 div 上：网格线（`border-r`/`border-b`）与卡片内缩
 * （`p-px`）逐格不同（最后一列/最后一行没有右边线/下边线），若把容器挂在带这些装饰的元素上，
 * 容器内容盒就会随「这是不是最后一列」变化 ~2.5%，同尺寸格子的字号立刻不一致。
 */
export const CELL_CONTAINER_CLASS = '[container-type:size]'

/**
 * 文字样式类：字号与行高都走 `--cc-*`。
 *
 * 用任意属性（`[font-size:…]`）而不是 `text-[length:…]`：后者让 Tailwind 去推断 `var()`
 * 的类型，推错就静默不生成规则；任意属性没有这层歧义。
 *
 * **`clamp()` / `calc()` / `var(--cc-scale)` 必须写在元素自己的 `font-size` 上，不能塞进网格
 * 声明的自定义属性里**：自定义属性中的 `var()` 是在**声明它的那个元素**上完成替换的，写在网格上的
 * `--cc-name` 会把网格上的 `--cc-scale`（网格上不存在 → 回落 1）固化进去，课程格上后设的
 * `--cc-scale` 就永远不生效（`cqw` / `cqh` 则相反，属于长度单位，会按使用处的容器解析）。
 * 所以网格只声明不含缩放、不含钳位的「基础长度」，缩放与钳位交给使用处。
 *
 * 顺序是「**先钳到可读区间、再乘兜底档位、最后再夹一次**」：如果写成「先乘档位、再钳上限」，
 * 当基准已经超过上限时（大视口下的宽格子）缩放会被上限吃掉——18.6px 的基准乘 0.9 仍是 16.7px、",
 * 被钳回 15px，等于兜底完全失效。
 *
 * 这两串必须是**字面量**：Tailwind 只扫描源文件里出现的字面类名，运行时拼出来的类名不会被生成
 * （实测：改成拼接后 computed `font-size` 直接回落到浏览器默认 16px、行高 1.5）。数值与上方
 * `CELL_SCALE` 必须一致——由 `cellScale.test.ts` 的形状断言钉住，改一边就会失败。
 */
export const CELL_FONT_CLASS = {
  name: '[font-size:clamp(8px,calc(clamp(8px,var(--cc-name-raw),15px)*var(--cc-scale,1)),15px)] [line-height:var(--cc-name-lh)]',
  room: '[font-size:clamp(8px,calc(clamp(8px,var(--cc-room-raw),12px)*var(--cc-scale,1)),12px)] [line-height:var(--cc-room-lh)]',
} as const
/** 卡片描边（常态）：半透明白内描边（纯白会被看成「卡片被缩小」），宽度随容器走。缺勤格改用 `CELL_ABSENT_RING_CLASS`。 */
export const CELL_RING_CLASS =
  '[box-shadow:inset_0_0_0_var(--cc-ring)_rgb(255_255_255_/_0.55)] focus-visible:[box-shadow:inset_0_0_0_var(--cc-ring)_rgb(255_255_255_/_0.55),0_0_0_2px_var(--ring)]'

/**
 * 卡片描边（浅色主题常态）：极细的半透明深灰内描边，给浅底卡片一条清晰边缘。
 *
 * 新版课程格改用「浅底 + 深字」，旧的半透明**白**内描边在浅底上几乎不可见，于是改用半透明
 * **深灰** `rgb(15 23 42 / 0.08)` 的内描边；宽度仍共用 `--cc-ring`（随容器走），缺勤仍走
 * `CELL_ABSENT_RING_CLASS`（实色红），聚焦态补一圈 `--ring`。**必须是字面量**（Tailwind 只扫源码里的类名）。
 */
export const CELL_SOFT_RING_CLASS =
  '[box-shadow:inset_0_0_0_var(--cc-ring)_rgb(15_23_42_/_0.08)] focus-visible:[box-shadow:inset_0_0_0_var(--cc-ring)_rgb(15_23_42_/_0.08),0_0_0_2px_var(--ring)]'

/**
 * 卡片描边（已上）：**柔和半透明绿**内描边，宽度与常态描边共用同一个 `--cc-ring`。
 *
 * 复刻历史提交 `247437d` 的轮廓观感：当时用的是 `ring-1 ring-inset ring-emerald-300/70`——
 * 浅绿 + 70% 透明的细描边，比后来那版实色饱和绿耐看得多。这里取 emerald-300
 * （`#6ee7b7` = `rgb(110 231 183)`）配 0.7 透明度；缺勤对应 `CELL_ABSENT_RING_CLASS`（柔和玫红）。
 * **这一串必须是字面量**（Tailwind 只扫描源码里出现的类名）。
 */
export const CELL_ATTENDED_RING_CLASS =
  '[box-shadow:inset_0_0_0_var(--cc-ring)_rgb(110_231_183_/_0.7)] focus-visible:[box-shadow:inset_0_0_0_var(--cc-ring)_rgb(110_231_183_/_0.7),0_0_0_2px_var(--ring)]'

/**
 * 卡片描边（缺勤）：**柔和半透明玫红**内描边，宽度与常态描边共用同一个 `--cc-ring`。
 *
 * 为什么缺勤不用「整卡变淡」：`opacity-60 saturate-50` 与非本周课程的淡化色观感雷同——同一张
 * 课表上「缺勤」与「这周没这节课」几乎分不出来，而且整卡发灰既不明显也不好看。缺勤走**边缘信号**：
 * 卡片底色照旧，只把描边换色——与非本周（换面色）在形状上就不同。
 *
 * 复刻历史提交 `247437d` 的轮廓观感：当时用的是 `ring-1 ring-inset ring-rose-300/70`。
 * 这里取 rose-300（`#fda4af` = `rgb(253 164 175)`）配 0.7 透明度，与已上绿 emerald-300/70 成对，
 * 比之前的实色饱和红柔和耐看。**这一串必须是字面量**，运行时拼出来的类名不会被 Tailwind 扫描生成。
 */
export const CELL_ABSENT_RING_CLASS =
  '[box-shadow:inset_0_0_0_var(--cc-ring)_rgb(253_164_175_/_0.7)] focus-visible:[box-shadow:inset_0_0_0_var(--cc-ring)_rgb(253_164_175_/_0.7),0_0_0_2px_var(--ring)]'

/** 出勤角标尺寸；角标只出现在**做过出勤判断**的格子上（见 `ScheduleCourseCell.tsx`）。 */
export const CELL_BADGE_CLASS = '[width:var(--cc-badge)] [height:var(--cc-badge)]'

function toVarName(key: CellScaleKey) {
  return `--cc-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`
}

/** 不含缩放、不含钳位的基础长度表达式（多项取较小值）。 */
function toBaseLength(spec: ScaleSpec) {
  const terms: string[] = []
  if (spec.cqw !== undefined) terms.push(`${spec.cqw}cqw`)
  if (spec.cqh !== undefined) terms.push(`${spec.cqh}cqh`)

  return terms.length > 1 ? `min(${terms.join(', ')})` : terms[0]
}

function toCssLength(spec: ScaleSpec) {
  return `clamp(${spec.min}px, ${toBaseLength(spec)}, ${spec.max}px)`
}

/**
 * 静态自定义属性表，挂到 `[data-schedule-grid]` 上。
 *
 * - **不参与兜底缩放的量**（内边距 / 描边 / 圆角 / 角标 / 表头与节次列字号）：直接给出完整的
 *   `clamp(...)`。继承到课程格后，里面的 `cqw` / `cqh` 由**该课程格自己的容器**解析。
 * - **参与兜底缩放的量**（`name` / `room`）：只声明基础长度（`--cc-<key>-raw`），**不含缩放也不含
 *   钳位**——原因见 `CELL_FONT_CLASS`：自定义属性里的 `var()` 会在声明它的元素上就替换掉，
 *   把缩放写在这里会让课程格上的 `--cc-scale` 永远进不来。
 */
export const cellScaleVars: Record<string, string> = {
  ...Object.fromEntries(
    (Object.entries(CELL_SCALE) as [CellScaleKey, ScaleSpec][]).map(([key, spec]): [string, string] =>
      SCALED_KEY_SET.has(key) ? [`--cc-${key}-raw`, toBaseLength(spec)] : [toVarName(key), toCssLength(spec)]
    )
  ),
  '--cc-name-lh': String(CELL_LINE_HEIGHT.name),
  '--cc-room-lh': String(CELL_LINE_HEIGHT.room),
}

/** 直接展开到 JSX `style` 的形态。 */
export const cellScaleStyle = cellScaleVars as CSSProperties

/**
 * `cellScaleStyle` 的可执行规格。
 *
 * 与 `toCssLength` 逐项对应：先取各长度项的**较小值**，再乘兜底系数（仅字号），
 * 最后夹到 `[min, max]`。单测断言它的单调性与上下限，浏览器验收断言
 * 「computed 字号 == resolveCellScale()」——两侧共用常量，不会漂移。
 *
 * @param containerWidth 课程格容器内容盒宽度（CSS px）。
 * @param containerHeight 课程格容器内容盒高度（CSS px）。
 * @param scale 兜底缩放系数，默认 1（未触发兜底）。
 * @returns 每个尺度键解析后的 px 值。
 */
export function resolveCellScale(containerWidth: number, containerHeight: number, scale = 1): Record<CellScaleKey, number> {
  const resolved = {} as Record<CellScaleKey, number>

  for (const [key, spec] of Object.entries(CELL_SCALE) as [CellScaleKey, ScaleSpec][]) {
    const terms: number[] = []
    if (spec.cqw !== undefined) terms.push((spec.cqw * containerWidth) / 100)
    if (spec.cqh !== undefined) terms.push((spec.cqh * containerHeight) / 100)

    const core = terms.length > 0 ? Math.min(...terms) : spec.max
    // 与 CSS 的嵌套 clamp 对齐：先夹到可读区间，再按相对比例缩，最后再夹一次。
    const base = Math.min(Math.max(core, spec.min), spec.max)
    const scaled = SCALED_KEY_SET.has(key) ? base * scale : base
    resolved[key] = Math.min(Math.max(scaled, spec.min), spec.max)
  }

  return resolved
}
