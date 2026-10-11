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

/**
 * 回归守卫（任务 `10-11-schedule-zoom-jank`）：缩放的预览变换是**受控例外**。
 *
 * 规范（`mobile-schedule-layout.md`「缩放的两段式」）允许在 `preview` / `settling` 两个相位里、
 * 在 stage 上写 `scaleX` + `translateX` 与一层模糊；除此之外：
 * - 静止态必须无内联 `transform` / `filter` / `transition`；
 * - 变换只许挂在 stage，不许挂在网格或滚容器（网格上的 transform 会计入滚动溢出区域，
 *   污染 `scrollWidth` 与边缘阻尼判定）；
 * - 模糊半径、时长这些数值只许有 `zoomPreview.ts` 一份真源。
 *
 * 这些断言都是真机上真实发生过或险些发生的回归，不是洁癖。
 */
describe('缩放预览的受控例外边界', () => {
  /** 允许写内联 `transform` / `filter` 的文件：缩放预览（stage）与横滑跟手（滚容器）。 */
  const TRANSFORM_WRITERS = ['hooks/useScheduleZoom.ts', 'hooks/useWeekSwipeGesture.ts']

  function relative(file: string): string {
    return file.slice(SCHEDULE_DIR.length).replace(/^\//, '')
  }

  it('只有白名单文件写内联 transform / filter', () => {
    const offenders: string[] = []
    const writePattern = /\.style\.(transform|filter)\b|\.style\.removeProperty\(['"](transform|filter)['"]\)/

    for (const file of FILES) {
      if (TRANSFORM_WRITERS.includes(relative(file))) continue
      for (const line of codeLines(readFileSync(file, 'utf8'))) {
        if (writePattern.test(line)) offenders.push(`${relative(file)}: ${line.trim()}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('白名单本身没写错（两个文件都确实在，且都在写）', () => {
    for (const name of TRANSFORM_WRITERS) {
      const file = join(SCHEDULE_DIR, name)
      expect(FILES).toContain(file)
      expect(readFileSync(file, 'utf8')).toMatch(/\.style\.(transform|filter)/)
    }
  })

  it('缩放预览的每一次变换写入都以 stage 为目标', () => {
    const hook = codeLines(readFileSync(join(SCHEDULE_DIR, 'hooks/useScheduleZoom.ts'), 'utf8'))
    const writes = hook.filter((line) => /\.style\.(transform|filter)\b/.test(line))

    expect(writes.length).toBeGreaterThan(0)
    for (const line of writes) {
      // 目标变量必须就是 `stage`（= `zoomStageRef.current`），不许是网格/滚容器/格子。
      expect(line).toContain('stage.style.')
    }
  })

  it('缩放预览不碰网格与滚容器的内联样式', () => {
    const hook = readFileSync(join(SCHEDULE_DIR, 'hooks/useScheduleZoom.ts'), 'utf8')

    expect(hook).not.toMatch(/gridRef\.current\.style/)
    expect(hook).not.toMatch(/scrollRef\.current\.style\.(transform|filter)/)
    // 表组件里一律不许出现内联变换（stage 的 ref 也在这里，写它必须走 hook）。
    expect(readFileSync(join(SCHEDULE_DIR, 'ScheduleTable.tsx'), 'utf8')).not.toContain('.style.transform')
  })

  it('不使用 CSS zoom，也不用 transform: scale', () => {
    const offenders: string[] = []

    for (const file of FILES) {
      for (const line of codeLines(readFileSync(file, 'utf8'))) {
        if (/zoom:\s*\d/.test(line)) offenders.push(`${relative(file)}: ${line.trim()}`)
        if (/transform:\s*scale[^X]/.test(line)) offenders.push(`${relative(file)}: ${line.trim()}`)
        if (/(^|[\s'"])scale-\d/.test(line)) offenders.push(`${relative(file)}: ${line.trim()}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('预览模糊半径只许有 zoomPreview.ts 一份真源', () => {
    const offenders: string[] = []

    for (const file of FILES) {
      if (relative(file) === 'zoomPreview.ts') continue
      for (const line of codeLines(readFileSync(file, 'utf8'))) {
        if (/blur\(\s*\d/.test(line)) offenders.push(`${relative(file)}: ${line.trim()}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('过渡时长不许写数值字面量（必须引常量）', () => {
    const hook = codeLines(readFileSync(join(SCHEDULE_DIR, 'hooks/useScheduleZoom.ts'), 'utf8'))
    const literalMs = hook.filter((line) => /\.style\.transition = `[^`]*\d+ms/.test(line))

    expect(literalMs).toEqual([])
    expect(readFileSync(join(SCHEDULE_DIR, 'hooks/useScheduleZoom.ts'), 'utf8')).toContain("from '../zoomPreview'")
  })

  it('stage 节点同时带裁剪层与缩放预览两个锚点', () => {
    const table = readFileSync(join(SCHEDULE_DIR, 'ScheduleTable.tsx'), 'utf8')
    const stageAt = table.indexOf('data-schedule-zoom-stage')

    expect(stageAt).toBeGreaterThan(-1)
    // 变换挂在这一层，正是靠 `overflow-hidden` 把预览多出来的部分裁掉（否则会撑出横向滚动）。
    expect(table).toContain('data-schedule-swipe-stage data-schedule-zoom-stage')
    expect(table.slice(stageAt, stageAt + 200)).toContain('overflow-hidden')
    expect(table).toContain('ref={zoomStageRef}')
  })
})
