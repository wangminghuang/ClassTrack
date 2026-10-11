import { describe, expect, it, vi } from 'vitest'
import { createCellLayoutQueue, fitCourseCells } from './cellLayout'
import type { CellLayoutJob } from './cellLayout'
import { CELL_FALLBACK_SCALES } from './cellScale'

function cell(id: string, log: string[], overflowUntil = -1, widthOverflow = false) {
  let stage = -1
  let width = 0
  const job: CellLayoutJob = {
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
