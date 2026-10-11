import { beforeEach, describe, expect, it } from 'vitest'
import { applyCellSnapshot } from './cellLayout'
import type { CellLayoutJob } from './cellLayout'
import {
  CACHE_MAX_ENTRIES,
  clearFitSnapshots,
  fitSnapshotCount,
  geometryKeyOf,
  lookupFitSnapshot,
  recordFitSnapshot,
  resolveTierApply,
  setCacheGeometry,
} from './cellLayoutCache'
import type { CellFitSnapshot } from './cellLayoutCache'

const SNAPSHOT: CellFitSnapshot = { hidden: 1, scale: 0.9, width: 24 }

/**
 * 只写不读的假课程格作业：任何读取都直接抛。
 *
 * 这是「套用预计算排布时零测量」这条契约的**唯一**可执行判据 —— 只要套用路径碰了
 * `overflows()` / `readUsedWidth()` / `widthOverflows()`，测试立刻失败。
 */
function writeOnlyJob(log: string[]): CellLayoutJob {
  return {
    contentKey: '',
    prepare: () => log.push('prepare'),
    overflows: () => {
      throw new Error('套用预计算排布时不得读 overflows()')
    },
    hideOptional: (index) => log.push(`hide:${index}`),
    setScale: (scale) => log.push(`scale:${scale}`),
    readUsedWidth: () => {
      throw new Error('套用预计算排布时不得读 readUsedWidth()')
    },
    setWidth: (width) => log.push(`width:${width}`),
    widthOverflows: () => {
      throw new Error('套用预计算排布时不得读 widthOverflows()')
    },
  }
}

beforeEach(() => {
  clearFitSnapshots()
  setCacheGeometry('379|600|true|false')
})

describe('档位排布缓存', () => {
  it('同一槽位可存可取', () => {
    expect(lookupFitSnapshot({ contentKey: 'c1', tier: 1 })).toBeUndefined()

    recordFitSnapshot({ contentKey: 'c1', tier: 1 }, SNAPSHOT)

    expect(lookupFitSnapshot({ contentKey: 'c1', tier: 1 })).toEqual(SNAPSHOT)
    expect(fitSnapshotCount()).toBe(1)
  })

  it('档位是键的一部分，不同档位互不串味', () => {
    recordFitSnapshot({ contentKey: 'c1', tier: 1 }, { hidden: 0, scale: 1, width: 0 })
    recordFitSnapshot({ contentKey: 'c1', tier: 2 }, { hidden: 2, scale: 1, width: 41 })

    expect(lookupFitSnapshot({ contentKey: 'c1', tier: 1 })).toEqual({ hidden: 0, scale: 1, width: 0 })
    expect(lookupFitSnapshot({ contentKey: 'c1', tier: 2 })).toEqual({ hidden: 2, scale: 1, width: 41 })
    expect(lookupFitSnapshot({ contentKey: 'c1', tier: 1.5 })).toBeUndefined()
  })

  it('内容签名变了就是另一条：不需要任何显式失效逻辑', () => {
    recordFitSnapshot({ contentKey: 'c1|数学|A203', tier: 2 }, SNAPSHOT)

    expect(lookupFitSnapshot({ contentKey: 'c1|数学|A101', tier: 2 })).toBeUndefined()
  })

  it('换几何键不清表：两套几何各留各的条目，且互不串味', () => {
    recordFitSnapshot({ contentKey: 'c1', tier: 2 }, SNAPSHOT)

    // 同一个几何键重复声明不误伤（`ScheduleTable` 每次 sync 都会调一次）。
    setCacheGeometry('379|600|true|false')
    expect(lookupFitSnapshot({ contentKey: 'c1', tier: 2 })).toEqual(SNAPSHOT)

    // 换一套几何（手机 2x 档出现水平滚动条，容器内容盒矮 15px）：旧条目查不到了，但没被丢掉。
    setCacheGeometry('379|585|true|false')
    expect(lookupFitSnapshot({ contentKey: 'c1', tier: 2 })).toBeUndefined()
    expect(fitSnapshotCount()).toBe(1)

    recordFitSnapshot({ contentKey: 'c1', tier: 2 }, { hidden: 2, scale: 1, width: 41 })

    // 切回去读到的还是原来那一条，不会被另一套几何的结果覆盖。
    setCacheGeometry('379|600|true|false')
    expect(lookupFitSnapshot({ contentKey: 'c1', tier: 2 })).toEqual(SNAPSHOT)
    expect(fitSnapshotCount()).toBe(2)
  })

  it('超出上限按插入序淘汰最早写入的一条', () => {
    for (let index = 0; index < CACHE_MAX_ENTRIES; index += 1) {
      recordFitSnapshot({ contentKey: `c${index}`, tier: 1 }, SNAPSHOT)
    }

    expect(fitSnapshotCount()).toBe(CACHE_MAX_ENTRIES)

    recordFitSnapshot({ contentKey: 'overflow', tier: 1 }, SNAPSHOT)

    expect(fitSnapshotCount()).toBe(CACHE_MAX_ENTRIES)
    expect(lookupFitSnapshot({ contentKey: 'c0', tier: 1 })).toBeUndefined()
    expect(lookupFitSnapshot({ contentKey: 'c1', tier: 1 })).toEqual(SNAPSHOT)
    expect(lookupFitSnapshot({ contentKey: 'overflow', tier: 1 })).toEqual(SNAPSHOT)
  })

  it('重复写入同一槽位会把它移到最新，不会被自己挤掉', () => {
    for (let index = 0; index < CACHE_MAX_ENTRIES; index += 1) {
      recordFitSnapshot({ contentKey: `c${index}`, tier: 1 }, SNAPSHOT)
    }

    recordFitSnapshot({ contentKey: 'c0', tier: 1 }, { hidden: 3, scale: 0.85, width: 0 })
    recordFitSnapshot({ contentKey: 'c1', tier: 1 }, SNAPSHOT)

    expect(lookupFitSnapshot({ contentKey: 'c0', tier: 1 })).toEqual({ hidden: 3, scale: 0.85, width: 0 })
  })
})

describe('几何键', () => {
  it('容器内容盒 / 列模板 / 断点任一不同就是另一套几何', () => {
    const base = geometryKeyOf({ width: 379, height: 548 }, 'even', true)

    expect(base).toBe(geometryKeyOf({ width: 379, height: 548 }, 'even', true))
    // 手机 1x→2x：水平滚动条吃掉 15px 内容盒高度（P4 实读 548 → 533）。
    expect(base).not.toBe(geometryKeyOf({ width: 379, height: 533 }, 'even', true))
    expect(base).not.toBe(geometryKeyOf({ width: 412, height: 548 }, 'even', true))
    expect(base).not.toBe(geometryKeyOf({ width: 379, height: 548 }, '2rem minmax(0,1fr) minmax(0,0.5rem)', true))
    expect(base).not.toBe(geometryKeyOf({ width: 379, height: 548 }, 'even', false))

    // 档位（`CacheSlot.tier`）与课程格宽度都不进键：前者是独立维度，后者本身就是档位的函数。
    // 这条由签名保证 —— `geometryKeyOf` 根本不接受档位。
  })
})

describe('档位套用', () => {
  it('全部命中时逐格套用，未命中名单为空', () => {
    recordFitSnapshot({ contentKey: 'c1', tier: 2 }, SNAPSHOT)
    recordFitSnapshot({ contentKey: 'c2', tier: 2 }, { hidden: 0, scale: 1, width: 0 })

    const applied: string[] = []
    const plan = resolveTierApply(
      [
        { contentKey: 'c1', apply: (snapshot) => applied.push(`c1:${snapshot.width}`) },
        { contentKey: 'c2', apply: (snapshot) => applied.push(`c2:${snapshot.width}`) },
      ],
      2
    )

    expect(plan).toEqual({ applied: 2, missing: [] })
    expect(applied).toEqual(['c1:24', 'c2:0'])
  })

  it('未命中的格子不进套用、只按下标登记进名单，由调用方恢复测量后补测', () => {
    recordFitSnapshot({ contentKey: 'c1', tier: 2 }, SNAPSHOT)

    const applied: string[] = []
    const plan = resolveTierApply(
      [
        { contentKey: 'c1', apply: () => applied.push('c1') },
        { contentKey: 'missing', apply: () => applied.push('missing') },
      ],
      2
    )

    expect(plan).toEqual({ applied: 1, missing: [1] })
    expect(applied).toEqual(['c1'])
  })

  it('缓存整体为空时不得套用任何东西（宁可实测，也不显示没算过的排布）', () => {
    const applied: string[] = []
    const plan = resolveTierApply(
      [
        { contentKey: 'c1', apply: () => applied.push('c1') },
        { contentKey: 'c2', apply: () => applied.push('c2') },
      ],
      1
    )

    expect(plan).toEqual({ applied: 0, missing: [0, 1] })
    expect(applied).toEqual([])
  })
})

describe('快照套用是纯写路径（AC2）', () => {
  it('套用一份快照只按既有顺序写、不读任何测量值', () => {
    const log: string[] = []
    const job = writeOnlyJob(log)

    expect(() => applyCellSnapshot(job, SNAPSHOT)).not.toThrow()
    expect(log).toEqual(['prepare', 'hide:0', 'scale:0.9', 'width:24'])
  })

  it('不隐藏任何可选行、也没走兜底时，不写 --cc-scale', () => {
    const log: string[] = []

    applyCellSnapshot(writeOnlyJob(log), { hidden: 0, scale: 1, width: 0 })

    expect(log).toEqual(['prepare', 'width:0'])
  })

  it('丢弃多行时按顺序逐行隐藏，与实测路径的 drop 顺序一致', () => {
    const log: string[] = []

    applyCellSnapshot(writeOnlyJob(log), { hidden: 3, scale: 0.75, width: 41 })

    expect(log).toEqual(['prepare', 'hide:0', 'hide:1', 'hide:2', 'scale:0.75', 'width:41'])
  })
})
