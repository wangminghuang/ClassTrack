import { describe, expect, it } from 'vitest'
import {
  CELL_ABSENT_RING_CLASS,
  CELL_ATTENDED_RING_CLASS,
  CELL_FALLBACK_SCALES,
  CELL_FONT_CLASS,
  CELL_LINE_HEIGHT,
  CELL_RING_CLASS,
  CELL_SCALE,
  CELL_SCALED_KEYS,
  SCALED_KEY_SET,
  cellScaleVars,
  resolveCellScale,
} from './cellScale'
import type { CellScaleKey } from './cellScale'

/** 桌面 1 节矮格 / 手机 2 节格 / 极窄视口等代表性容器内容盒尺寸。 */
const CONTAINER_SIZES: [number, number][] = [
  [7, 59],
  [12, 59],
  [24, 59],
  [39, 59],
  [39, 119],
  [50, 119],
  [61, 119],
  [89, 119],
  [96, 59],
  [189, 119],
  [400, 119],
]

describe('课程格尺度公式', () => {
  it('课名字号随容器宽度单调不减（同一容器高度下）', () => {
    let previous = 0
    for (let width = 8; width <= 200; width += 2) {
      const { name } = resolveCellScale(width, 119)
      expect(name).toBeGreaterThanOrEqual(previous)
      previous = name
    }
    expect(previous).toBeGreaterThan(8)
  })

  it('课名字号随容器高度单调不减（同一容器宽度下，仅 cqh 项生效的区间）', () => {
    let previous = 0
    for (let height = 10; height <= 240; height += 2) {
      const { name } = resolveCellScale(400, height)
      expect(name).toBeGreaterThanOrEqual(previous)
      previous = name
    }
  })

  it('所有尺度都落在常量声明的 [min, max] 内', () => {
    for (const [width, height] of CONTAINER_SIZES) {
      for (const scale of [1, ...CELL_FALLBACK_SCALES]) {
        const resolved = resolveCellScale(width, height, scale)
        for (const [key, spec] of Object.entries(CELL_SCALE) as [CellScaleKey, { min: number; max: number }][]) {
          expect(resolved[key], `${key} @ ${width}x${height} scale=${scale}`).toBeGreaterThanOrEqual(spec.min)
          expect(resolved[key], `${key} @ ${width}x${height} scale=${scale}`).toBeLessThanOrEqual(spec.max)
        }
      }
    }
  })

  it('教室字号永远不超过课名字号，且在两者都未触限的区间内比值恒定', () => {
    // 任何尺寸：教室不得比课名大（信息分级不得反转）
    for (const [width, height] of CONTAINER_SIZES) {
      const { name, room } = resolveCellScale(width, height)
      expect(room).toBeLessThanOrEqual(name)
    }

    // 两侧都未触及 8px 下限 / 各自上限的区间（容器宽 38–55px）：比值必须钉死在 21.5 / 24
    const expectedRatio = CELL_SCALE.room.cqw / CELL_SCALE.name.cqw
    for (let width = 38; width <= 55; width += 1) {
      const { name, room } = resolveCellScale(width, 400)
      expect(name).toBeGreaterThan(CELL_SCALE.name.min)
      expect(name).toBeLessThan(CELL_SCALE.name.max)
      expect(room).toBeGreaterThan(CELL_SCALE.room.min)
      expect(room).toBeLessThan(CELL_SCALE.room.max)
      expect(room / name).toBeCloseTo(expectedRatio, 10)
    }
  })

  it('“又宽又矮”的格子由 cqh 项收住字号，不会大到一行放不下', () => {
    const wide = resolveCellScale(400, 40)
    // 400cqw 早已越过上限，只有 cqh 项能把结果压下来
    expect(wide.name).toBeCloseTo(CELL_SCALE.name.cqh * 0.4, 6)
    expect(wide.name).toBeLessThan(CELL_SCALE.name.max)
  })

  it('兜底只缩字号，不缩几何量', () => {
    const base = resolveCellScale(39, 119, 1)
    const shrunk = resolveCellScale(39, 119, 0.8)

    expect(shrunk.name).toBeLessThan(base.name)
    expect(shrunk.room).toBeLessThan(base.room)
    for (const key of Object.keys(CELL_SCALE) as CellScaleKey[]) {
      if (SCALED_KEY_SET.has(key)) continue
      expect(shrunk[key], `${key} 不应被兜底缩放影响`).toBe(base[key])
    }
  })

  it('兜底不会突破 8px 下限', () => {
    for (const scale of [0.8, 0.5, 0.1]) {
      const { name, room } = resolveCellScale(10, 40, scale)
      expect(name).toBeGreaterThanOrEqual(CELL_SCALE.name.min)
      expect(room).toBeGreaterThanOrEqual(CELL_SCALE.room.min)
    }
  })

  it('行高只有一个值：正常态与兜底态共用同一组系数', () => {
    expect(cellScaleVars['--cc-name-lh']).toBe(String(CELL_LINE_HEIGHT.name))
    expect(cellScaleVars['--cc-room-lh']).toBe(String(CELL_LINE_HEIGHT.room))
    // 行高不得出现在任何内联写入路径里——它只由常量提供
    expect(CELL_LINE_HEIGHT.name).toBe(1.15)
    expect(CELL_LINE_HEIGHT.room).toBe(1.2)
  })
})

describe('尺度变量是容器单位，不是硬编码 px', () => {
  it('不参与缩放的尺度变量直接是完整的 clamp，中项由 cqw / cqh 驱动', () => {
    for (const key of Object.keys(CELL_SCALE) as CellScaleKey[]) {
      if (SCALED_KEY_SET.has(key)) continue
      const varName = `--cc-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`
      const value = cellScaleVars[varName]
      expect(value, `${varName} 缺失`).toBeTypeOf('string')
      expect(value, `${varName} = ${value} 的中项不含容器单位`).toMatch(/^clamp\(\d+px, .*(cqw|cqh).*, \d+px\)$/)
      expect(value, `${varName} 不该带兜底缩放`).not.toContain('--cc-scale')
    }
  })

  it('参与缩放的尺度变量只给「不含缩放、不含钳位」的基础长度', () => {
    // 这是回归守卫：自定义属性里的 var() 会在**声明它的元素**（网格）上就替换掉，
    // 一旦把 var(--cc-scale) 或 clamp 写进网格声明的 --cc-name，课程格上后设的
    // --cc-scale 就永远进不来（浏览器实测：scale=0.8 时字号完全没缩）。
    for (const key of CELL_SCALED_KEYS) {
      const value = cellScaleVars[`--cc-${key}-raw`]
      expect(value, `--cc-${key}-raw 缺失`).toBeTypeOf('string')
      expect(value, `--cc-${key}-raw = ${value}`).toMatch(/^(min\(.*\)|\d+(\.\d+)?(cqw|cqh))$/)
      expect(value).not.toContain('clamp')
      expect(value).not.toContain('--cc-scale')
      expect(cellScaleVars[`--cc-${key}`]).toBeUndefined()
    }
  })

  it('缩放与钳位写在元素自己的 font-size 上，因此 --cc-scale 才生效', () => {
    for (const key of CELL_SCALED_KEYS) {
      const cls = CELL_FONT_CLASS[key]
      expect(cls, `${key} 的字号类`).toContain(`var(--cc-${key}-raw)`)
      expect(cls, `${key} 的字号类必须在使用处乘 --cc-scale`).toContain('var(--cc-scale,1)')
      expect(cls, `${key} 的字号类必须在使用处钳位`).toMatch(/font-size:clamp\(8px,/)
      expect(cls).not.toMatch(/text-\[\d/)
      expect(cls).not.toMatch(/\d+px\]/)
    }
  })

  it('挂到网格上的是静态字符串，不含任何与实测尺寸相关的插值', () => {
    const values = Object.values(cellScaleVars)
    expect(values.length).toBe(Object.keys(CELL_SCALE).length + 2)
    for (const value of values) {
      expect(value).not.toContain('NaN')
      expect(value).not.toContain('undefined')
    }
  })

  it('文字类里的 px 只出现在 clamp 的可读性上下限里，不是硬编码字号', () => {
    for (const key of CELL_SCALED_KEYS) {
      const spec = CELL_SCALE[key]
      const cls = CELL_FONT_CLASS[key]
      // 整串必须精确是这个形状：基础长度 × 兜底系数 → 再钳到 [min, max]
      const expected =
        `\\[font-size:clamp\\(${spec.min}px,calc\\(clamp\\(${spec.min}px,var\\(--cc-${key}-raw\\),${spec.max}px\\)` +
        `\\*var\\(--cc-scale,1\\)\\),${spec.max}px\\)\\] \\[line-height:var\\(--cc-${key}-lh\\)\\]`

      expect(cls, `${key} 的字号类形状`).toMatch(new RegExp(`^${expected}$`))
    }
  })
})

describe('卡片描边常量', () => {
  it('常态半透明白、已上柔和绿、缺勤柔和玫红，且几种描边的宽度共用同一个 --cc-ring', () => {
    for (const cls of [CELL_RING_CLASS, CELL_ATTENDED_RING_CLASS, CELL_ABSENT_RING_CLASS]) {
      expect(cls).toContain('inset_0_0_0_var(--cc-ring)')
      // 出勤描边不为宽度另起一套尺度：宽度只能来自 --cc-ring
      expect(cls).not.toMatch(/inset_0_0_0_\d+px/)
    }

    expect(CELL_RING_CLASS).toContain('rgb(255_255_255_/_0.55)')
    // 已上绿 = emerald-300 #6ee7b7 配 0.7 透明度（复刻提交 247437d 的 ring-emerald-300/70）
    expect(CELL_ATTENDED_RING_CLASS).toContain('rgb(110_231_183_/_0.7)')
    // 缺勤玫红 = rose-300 #fda4af 配 0.7 透明度（复刻提交 247437d 的 ring-rose-300/70）
    expect(CELL_ABSENT_RING_CLASS).toContain('rgb(253_164_175_/_0.7)')
  })

  it('已上绿 / 缺勤玫红都是柔和半透明（带 `/ 0.7` 透明度修饰）', () => {
    // Tailwind 任意值里的 `_` 是空格，所以透明度形如 `_/_0.7`
    expect(CELL_ATTENDED_RING_CLASS).toMatch(/rgb\([^)]*_\/_0\.7\)/)
    expect(CELL_ABSENT_RING_CLASS).toMatch(/rgb\([^)]*_\/_0\.7\)/)
  })

  it('键盘聚焦态仍走外圈，且不丢内描边', () => {
    for (const cls of [CELL_RING_CLASS, CELL_ATTENDED_RING_CLASS, CELL_ABSENT_RING_CLASS]) {
      expect(cls).toContain('focus-visible:[box-shadow:')
      expect(cls).toContain('0_0_0_2px_var(--ring)')
    }
  })
})
