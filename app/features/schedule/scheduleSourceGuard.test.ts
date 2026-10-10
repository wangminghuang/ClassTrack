import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 源码守卫：把「课表尺度必须由格子尺寸推导」这件事从人工约定变成会失败的测试。
 *
 * 这些断言对应的都是真机上真实发生过的回归（见任务 `09-24-schedule-responsive-sizing`
 * 的 `research/real-device-analysis.md`）：改动前同一个屏幕里出现 10px 与 8px 两种课名字号，
 * 根因就是与格子尺寸无关的硬编码 px 字号 + 视口布尔值判据。
 */
const SCHEDULE_DIR = fileURLToPath(new URL('.', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(entry.name)) return []
    if (entry.name.endsWith('.test.ts')) return []
    return [full]
  })
}

/** 去掉整行注释，避免注释里为了说明历史而写的例子触发守卫。 */
function codeLines(source: string): string[] {
  return source.split('\n').filter((line) => {
    const trimmed = line.trim()
    return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
  })
}

const FILES = sourceFiles(SCHEDULE_DIR)

describe('schedule 目录源码守卫', () => {
  it('确实扫到了课表源码（防止守卫因为路径变化静默空跑）', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(8)
    expect(FILES.some((file) => file.endsWith('ScheduleCourseCell.tsx'))).toBe(true)
    expect(FILES.some((file) => file.endsWith('ScheduleTable.tsx'))).toBe(true)
  })

  it('没有任何与格子尺寸无关的 px 字号（AC-A9）', () => {
    const offenders: string[] = []

    for (const file of FILES) {
      for (const line of codeLines(readFileSync(file, 'utf8'))) {
        if (/text-\[\d+px\]/.test(line)) offenders.push(`${file}: ${line.trim()}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('没有任何 sm: 断点（AC-C1：统一到 md: 768px，与 useIsMobile 一致）', () => {
    const offenders: string[] = []

    for (const file of FILES) {
      for (const line of codeLines(readFileSync(file, 'utf8'))) {
        if (/(^|[\s'"])sm:/.test(line)) offenders.push(`${file}: ${line.trim()}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('课程格组件不再依赖视口布尔值（AC-B2：判据必须是格子尺寸）', () => {
    const cell = readFileSync(join(SCHEDULE_DIR, 'ScheduleCourseCell.tsx'), 'utf8')

    expect(cell).not.toContain('useIsMobile')
    expect(cell).not.toContain('use-mobile')
    // 也不许再用「按 px 硬减」的兜底
    expect(cell).not.toMatch(/baseName|baseRoom/)
    expect(cell).not.toMatch(/style\.fontSize/)
    expect(cell).not.toMatch(/style\.lineHeight/)
  })

  it('课程格的字号与行高只能来自 --cc-* 容器变量', () => {
    const cell = readFileSync(join(SCHEDULE_DIR, 'ScheduleCourseCell.tsx'), 'utf8')

    expect(cell).toContain('CELL_FONT_CLASS')
    expect(cell).not.toMatch(/leading-\[/)
    expect(cell).not.toMatch(/leading-\d/)
  })

  it('缺勤描边的颜色只有 cellScale.ts 一处真源（组件里不得内联颜色字面量）', () => {
    const cell = readFileSync(join(SCHEDULE_DIR, 'ScheduleCourseCell.tsx'), 'utf8')

    // 回归守卫：描边宽度已有 `--cc-ring` 单一真源，颜色同理。组件里内联 `#ef4444` / `rgb(...)`
    // 会让「改配色只改一处」失效，也会绕过 cellScale.test.ts 的形状断言。
    expect(cell).not.toMatch(/#[0-9a-fA-F]{6}/)
    expect(cell).not.toMatch(/rgb\(/)
    expect(cell).toContain('CELL_ABSENT_RING_CLASS')
  })

  it('尺度常量集中在 cellScale.ts，组件里不出现第二份数值', () => {
    const cell = readFileSync(join(SCHEDULE_DIR, 'ScheduleCourseCell.tsx'), 'utf8')
    const table = readFileSync(join(SCHEDULE_DIR, 'ScheduleTable.tsx'), 'utf8')

    expect(cell).not.toMatch(/cqw|cqh/)
    expect(table).not.toMatch(/cqw|cqh/)
    expect(cell).toContain("from './cellScale'")
    expect(table).toContain("from './cellScale'")
  })
  // 回归守卫（任务 `10-10-schedule-scroll-device-rootcause`）：网格高度必须「至少填满容器、再随内容长高」。
  // 钉死成 `h-full` 会让 12 节行（36px 表头 + 12×62px = 780px）溢出网格自己的盒子，而 Android WebView 120
  // （真机实测，API 32 / Chrome 120，跑用户装的 beta-29）**不把这段行溢出算进祖先 `[data-schedule-scroll]`
  // 的可滚区域** ⇒ `scrollHeight == clientHeight`、`maxScrollTop == 0`，表现为「课表整体滑不动、
  // 第 9~12 节永远到不了」；改成 `min-h-full` 后同一台引擎实测可滚到 270（= max）。
  it('课表网格不得钉死为容器高度（h-full）', () => {
    const table = readFileSync(join(SCHEDULE_DIR, 'ScheduleTable.tsx'), 'utf8')
    const gridAt = table.indexOf('data-schedule-grid')

    expect(gridAt).toBeGreaterThan(-1)
    expect(table).not.toContain("'grid h-full")
    expect(table).toContain("'grid min-h-full")
    // 网格节点的 class 里确实带着 min-h-full（防止上面两条被别处的字符串满足）。
    expect(table.slice(gridAt, gridAt + 1200)).toContain('min-h-full')
    // 12 节最小行高契约仍在：它正是「手机一屏放不下 12 节、必须能滚」的前提。
    expect(table).toContain('grid-rows-[2.25rem_repeat(12,minmax(3.875rem,1fr))]')
  })
})
