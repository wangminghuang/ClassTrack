import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCellLayoutQueue, fitCourseCells, setCellLayoutGeometryReader, setCellLayoutTier } from './cellLayout'
import type { CellLayoutJob } from './cellLayout'
import { clearFitSnapshots, fitSnapshotCount, lookupFitSnapshot, recordFitSnapshot, setCacheGeometry } from './cellLayoutCache'
import { CELL_FALLBACK_SCALES } from './cellScale'

function cell(id: string, log: string[], overflowUntil = -1, widthOverflow = false, contentKey = '') {
  let stage = -1
  let width = 0
  const job: CellLayoutJob = {
    contentKey,
    prepare: () => log.push(`${id}:prepare`),
    overflows: () => {
      log.push(`${id}:read:${stage}`)
      return stage < overflowUntil
    },
    hideOptional: (index) => {
      stage = index
      log.push(`${id}:hide:${index}`)
    },
    setScale: (scale) => {
      stage += 1
      log.push(`${id}:scale:${scale}`)
    },
    readUsedWidth: () => {
      log.push(`${id}:readWidth`)
      return 30.2
    },
    setWidth: (value) => {
      width = value
      log.push(`${id}:width:${value}`)
    },
    widthOverflows: () => widthOverflow && width > 0,
  }
  return job
}

/**
 * 读就抛的假课程格作业：`overflows()` / `readUsedWidth()` / `widthOverflows()` 一碰就抛。
 *
 * 「命中预计算 ⇒ 零测量」这条契约只能这样钉住：纯写路径里只要混进任何一次读取，测试立刻红。
 * 它与 `cellLayoutCache.test.ts` 的 `writeOnlyJob` 是同一手法的两个面 —— 那边钉的是**套用**
 * （`applyCellSnapshot`）不读，这边钉的是**命中**（`fitCourseCells`）不读。
 *
 * @param id 日志前缀。
 * @param contentKey 内容签名（命中缓存的依据）。
 * @param log 写入日志。
 */
function readProofCell(id: string, contentKey: string, log: string[]): CellLayoutJob {
  return {
    contentKey,
    prepare: () => log.push(`${id}:prepare`),
    overflows: () => {
      throw new Error('命中预计算时必须零测量，不得读 overflows()')
    },
    hideOptional: (index) => log.push(`${id}:hide:${index}`),
    setScale: (scale) => log.push(`${id}:scale:${scale}`),
    readUsedWidth: () => {
      throw new Error('命中预计算时必须零测量，不得读 readUsedWidth()')
    },
    setWidth: (width) => log.push(`${id}:width:${width}`),
    widthOverflows: () => {
      throw new Error('命中预计算时必须零测量，不得读 widthOverflows()')
    },
  }
}

describe('课程格分阶段批量测量', () => {
  it('同阶段先读完所有格子再写，不能每格交错读写', () => {
    const log: string[] = []
    fitCourseCells([cell('a', log, 0), cell('b', log, 0)])
    expect(log.slice(0, 6)).toEqual(['a:prepare', 'b:prepare', 'a:read:-1', 'b:read:-1', 'a:hide:0', 'b:hide:0'])
    expect(log.indexOf('b:readWidth')).toBeLessThan(log.indexOf('a:width:31'))
  })

  it('放得下的格子不丢弃字段、不缩字号，溢出格按备注/教师/标签逐级丢弃', () => {
    const log: string[] = []
    fitCourseCells([cell('fits', log), cell('short', log, 2)])
    expect(log.filter((s) => s.startsWith('fits:hide') || s.startsWith('fits:scale'))).toEqual([])
    expect(log.filter((s) => s.startsWith('short:hide'))).toEqual(['short:hide:0', 'short:hide:1', 'short:hide:2'])
    expect(log.filter((s) => s.includes(':scale'))).toEqual([])
  })

  it('兜底只走既有阶梯，刚好放下即停止；无解时停在下限', () => {
    const log: string[] = []
    fitCourseCells([cell('fit', log, 4), cell('never', log, 99)])
    expect(log.filter((s) => s.startsWith('fit:scale'))).toEqual(['fit:scale:0.95', 'fit:scale:0.9'])
    expect(log.filter((s) => s.startsWith('never:scale'))).toEqual(CELL_FALLBACK_SCALES.map((s) => `never:scale:${s}`))
  })

  it('收窄后水平或垂直溢出时退回整宽', () => {
    const log: string[] = []
    fitCourseCells([cell('horizontal', log, -1, true), cell('vertical', log, 99)])
    expect(log).toContain('horizontal:width:0')
    expect(log).toContain('vertical:width:0')
  })
})

describe('课程格测量队列', () => {
  function harness() {
    const callbacks = new Map<number, () => void>()
    let nextId = 0
    const request = vi.fn((callback: () => void) => {
      callbacks.set(++nextId, callback)
      return nextId
    })
    const cancel = vi.fn((id: number) => callbacks.delete(id))
    const flush = vi.fn()
    const queue = createCellLayoutQueue(request, cancel, flush)
    const frame = () => {
      const entries = [...callbacks.values()]
      callbacks.clear()
      entries.forEach((f) => f())
    }
    return { queue, request, cancel, flush, frame }
  }

  it('挂载/尺寸/字体同轮通知合并为一次批量测量', () => {
    const { queue, request, flush, frame } = harness()
    const a = cell('a', [])
    const b = cell('b', [])
    queue.enqueue(a)
    queue.enqueue(a)
    queue.enqueue(b)
    expect(request).toHaveBeenCalledTimes(1)
    frame()
    expect(flush).toHaveBeenCalledExactlyOnceWith([a, b])
    queue.enqueue(a)
    frame()
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('卸载/内容更新撤销旧任务，不影响其它格子', () => {
    const { queue, cancel, flush, frame } = harness()
    const a = cell('a', [])
    const b = cell('b', [])
    queue.enqueue(a)
    queue.enqueue(b)
    queue.remove(a)
    frame()
    expect(flush).toHaveBeenCalledExactlyOnceWith([b])
    queue.enqueue(b)
    queue.remove(b)
    expect(cancel).toHaveBeenCalledTimes(1)
    frame()
    expect(flush).toHaveBeenCalledTimes(1)
  })
})

describe('档位排布缓存接入适配路径', () => {
  beforeEach(() => {
    clearFitSnapshots()
    // 两处必须一致：`fitCourseCells` 在批次开头现读几何（见 `setCellLayoutGeometryReader`），
    // 而测试里手写 `recordFitSnapshot` 的那一条用的是调用时的当前几何（`setCacheGeometry`）。
    setCellLayoutGeometryReader(() => '379|600|true|false')
    setCacheGeometry('379|600|true|false')
  })

  it('命中缓存时按预计算纯写套用，一次测量都不做', () => {
    const log: string[] = []
    recordFitSnapshot({ contentKey: 'c1|数学|A203', tier: 2 }, { hidden: 1, scale: 0.9, width: 24 })

    setCellLayoutTier(2)

    // 作业的读取全部会抛：命中路径里只要出现任何一次测量，这个用例就红。
    expect(() => fitCourseCells([readProofCell('c1', 'c1|数学|A203', log)])).not.toThrow()
    expect(log).toEqual(['c1:prepare', 'c1:hide:0', 'c1:scale:0.9', 'c1:width:24'])
  })

  it('首访档位走实测，并把结果回读进缓存：同一签名第二次就命中了', () => {
    const log: string[] = []
    setCellLayoutTier(2)

    fitCourseCells([cell('c1', log, 1, false, 'c1|数学|A203')])

    expect(log).toContain('c1:readWidth')
    expect(lookupFitSnapshot({ contentKey: 'c1|数学|A203', tier: 2 })).toEqual({ hidden: 2, scale: 1, width: 31 })

    // 第二次换成读就抛的作业：命中即零测量，写下去的还是那套装法。
    const second: string[] = []
    expect(() => fitCourseCells([readProofCell('c1', 'c1|数学|A203', second)])).not.toThrow()
    expect(second).toEqual(['c1:prepare', 'c1:hide:0', 'c1:hide:1', 'c1:width:31'])
  })

  it('实测结果按当前档位入库，不会串到别的档位', () => {
    setCellLayoutTier(1.5)
    fitCourseCells([cell('c1', [], 1, false, 'c1|数学|A203')])

    expect(fitSnapshotCount()).toBe(1)
    expect(lookupFitSnapshot({ contentKey: 'c1|数学|A203', tier: 1.5 })).toEqual({ hidden: 2, scale: 1, width: 31 })
    expect(lookupFitSnapshot({ contentKey: 'c1|数学|A203', tier: 2 })).toBeUndefined()
  })

  it('只有未命中的格子走实测，命中的格子一次都不重测', () => {
    const log: string[] = []
    recordFitSnapshot({ contentKey: 'hit', tier: 2 }, { hidden: 0, scale: 1, width: 41 })

    setCellLayoutTier(2)
    fitCourseCells([readProofCell('hit', 'hit', log), cell('miss', log, 0, false, 'miss')])

    // 命中的只写（读会抛，能跑通就说明没读）；未命中的走完整实测。
    expect(log.filter((line) => line.startsWith('hit:'))).toEqual(['hit:prepare', 'hit:width:41'])
    expect(log).toContain('miss:read:-1')
    expect(log).toContain('miss:readWidth')
    expect(lookupFitSnapshot({ contentKey: 'miss', tier: 2 })).toEqual({ hidden: 1, scale: 1, width: 31 })
  })

  it('内容签名变了就是另一条：教室改一个字就重新实测', () => {
    setCellLayoutTier(2)
    fitCourseCells([cell('c1', [], 0, false, 'c1|数学|A203')])
    fitCourseCells([cell('c1', [], 2, false, 'c1|数学|A204')])

    expect(lookupFitSnapshot({ contentKey: 'c1|数学|A203', tier: 2 })).toEqual({ hidden: 1, scale: 1, width: 31 })
    expect(lookupFitSnapshot({ contentKey: 'c1|数学|A204', tier: 2 })).toEqual({ hidden: 3, scale: 1, width: 31 })
    expect(fitSnapshotCount()).toBe(2)
  })

  it('空签名的作业不可缓存：照常实测，但一条都不入库', () => {
    const log: string[] = []
    setCellLayoutTier(2)

    fitCourseCells([cell('c1', log), cell('c2', log)])

    expect(log).toContain('c1:read:-1')
    expect(fitSnapshotCount()).toBe(0)
  })
})
