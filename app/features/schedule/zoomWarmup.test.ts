import { describe, expect, it } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_TIERS } from './constants'
import { WARMUP_CELLS_PER_SLICE, isWarmupStale, warmupSlices, warmupTiers } from './zoomWarmup'

describe('预热档位选择', () => {
  it('预热当前档位之外的全部档位', () => {
    expect(warmupTiers(ZOOM_MIN)).toEqual([1.5, ZOOM_MAX])
    expect(warmupTiers(1.5)).toEqual([ZOOM_MIN, ZOOM_MAX])
    expect(warmupTiers(ZOOM_MAX)).toEqual([ZOOM_MIN, 1.5])
  })

  it('三档表恒定时，任何档位都恰好预热另外两档', () => {
    for (const tier of ZOOM_TIERS) {
      const tiers = warmupTiers(tier)
      expect(tiers).toHaveLength(ZOOM_TIERS.length - 1)
      expect(tiers).not.toContain(tier)
    }
  })

  it('认识的档位之外的值也应得到全部档位（宁可多预热，不可漏）', () => {
    expect(warmupTiers(0)).toEqual([...ZOOM_TIERS])
  })
})

describe('预热分片', () => {
  it('按每片 4 格切开，且不重不漏地覆盖全部格子', () => {
    const slices = warmupSlices(18)

    expect(slices).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
      [12, 16],
      [16, 18],
    ])
    expect(slices.flatMap(([from, to]) => Array.from({ length: to - from }, (_, index) => from + index))).toEqual(
      Array.from({ length: 18 }, (_, index) => index)
    )
  })

  it('格子数不足一片时只给一片', () => {
    expect(warmupSlices(2)).toEqual([[0, 2]])
  })

  it('没有格子时不给分片', () => {
    expect(warmupSlices(0)).toEqual([])
    expect(warmupSlices(-3)).toEqual([])
  })

  it('片长可覆盖，且非法片长回落到 1 格（不允许出现零长度片而空转）', () => {
    expect(warmupSlices(5, 2)).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
    ])
    expect(warmupSlices(2, 0)).toEqual([
      [0, 1],
      [1, 2],
    ])
    expect(warmupSlices(2, 1.8)).toEqual([
      [0, 1],
      [1, 2],
    ])
  })

  it('默认片长就是导出的常量', () => {
    expect(warmupSlices(WARMUP_CELLS_PER_SLICE * 2 + 1)).toHaveLength(3)
  })
})

describe('预热前提失效判定', () => {
  it('几何没变且未取消时，前提仍成立', () => {
    expect(isWarmupStale({ geometry: '379|780|even|mobile', cancelled: false }, '379|780|even|mobile')).toBe(false)
  })

  it('几何一变就失效 —— 已算完的部分与新几何不再配套，整体放弃比半途续算干净', () => {
    expect(isWarmupStale({ geometry: '379|780|even|mobile', cancelled: false }, '379|781|even|mobile')).toBe(true)
  })

  it('已取消的批次一律失效，不看几何', () => {
    expect(isWarmupStale({ geometry: 'a', cancelled: true }, 'a')).toBe(true)
  })
})
