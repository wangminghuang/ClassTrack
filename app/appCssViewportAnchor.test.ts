import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `html, body` 的视口高度锚点契约（来源任务 `09-29-fix-schedule-scroll-legacy-webview`）。
 *
 * 为什么单独钉这一条：`height: 100%` 与 `height: 100dvh` 写在**同一条规则**里时，Tailwind v4 的
 * lightningcss 会把前一条当「被后一条覆盖的冗余声明」删掉，产物里就只剩 `dvh`。于是不认识 `dvh` 的
 * WebView（Chromium ≤ 107 / Safari < 15.4）上 `html/body` 变成 `height: auto`，应用外壳整条
 * `height:100%` 链失去锚点 —— 课表区域的 `scrollHeight` 涨到等于 `clientHeight`、**完全无法上下滑动**，
 * 且溢出部分被 `overflow: hidden` 裁掉，用户既滚不到也看不到。这个回归**没有任何运行时报错**，
 * 只能靠契约检查挡住。
 *
 * 本文件只做**源文件结构**断言（零新依赖）；「构建器到底有没有把它删掉」由产物断言负责：
 * `scripts/check-webview-css-fallback.js`（读 `build/client/assets/*.css`）。
 */
/** `app.css` 原文。 */
const APP_CSS_SOURCE = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8')

/** 扫描用副本：注释替换成等长空白，避免定位选择器时被注释里的标点带偏（下标与原文件一一对应）。 */
const APP_CSS = APP_CSS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length))

type FoundRule = {
  /** 选择器在源文件里的起始下标（用于断言层叠顺序）。 */
  index: number
  /** 规则体的内容（不含最外层花括号）。 */
  body: string
}

/** 从 `{` 开始做花括号配对，返回规则体内容。 */
function readBlock(source: string, openIndex: number): string {
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex + 1, index)
    }
  }
  throw new Error('花括号没有闭合')
}

/**
 * 按**空白归一化后的选择器**定位规则，因此 `html,\nbody {` 与 `html, body {` 都能命中
 * （不让断言绑死在 prettier 的换行选择上）。
 */
function findAllRules(source: string, selector: string): FoundRule[] {
  const wanted = normalizeSelector(selector)
  const matches: FoundRule[] = []

  let cursor = 0
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor)
    if (open === -1) break

    // 选择器总是紧跟在 `{` / `}` / `;` 之后，取最近的一个作边界（`{` 覆盖 @layer / @supports 里的规则）。
    const boundary = Math.max(source.lastIndexOf('}', open - 1), source.lastIndexOf(';', open - 1), source.lastIndexOf('{', open - 1))
    const candidate = normalizeSelector(source.slice(boundary + 1, open))

    if (candidate === wanted) matches.push({ index: boundary + 1, body: readBlock(source, open) })
    cursor = open + 1
  }

  return matches
}

/**
 * 取**第一条**匹配的规则。
 *
 * 同一选择器在 app.css 里可能有多条（例如 `html, body` 的基础规则 + `@supports (height: 100dvh)` 里的
 * 升级规则），需要全部时用 `findAllRules`；这里返回的第一条正是「基础规则」。
 */
function findRule(source: string, selector: string): FoundRule {
  const [first] = findAllRules(source, selector)
  expect(first, `app.css 里应至少有一条 ${normalizeSelector(selector)} 规则`).toBeDefined()
  return first
}

/**
 * 选择器归一化：空白折叠 + 逗号两侧去空白，于是 `html, body` / `html,\nbody` / `html,body` 等价
 * （断言不绑死在 prettier 的换行选择上）。
 *
 * @param value 原始选择器文本。
 * @returns 归一化后的选择器。
 */
function normalizeSelector(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .trim()
}

/** 规则体里所有 `height` 声明的值（按出现顺序）。 */
function heightValues(body: string): string[] {
  return [...body.matchAll(/(?:^|[\s;{])height\s*:\s*([^;]+);/g)].map((match) => match[1].trim())
}

describe('app.css 视口高度锚点', () => {
  it('html, body 只留一条 height 兜底（100%），禁止同规则双写', () => {
    const rule = findRule(APP_CSS, 'html, body')
    // 双写 height:100% + height:100dvh 就是本次线上缺陷的成因：构建器会删掉前者。
    expect(heightValues(rule.body)).toEqual(['100%'])
  })

  it('用独立的 @supports (height: 100dvh) 块升级为 dvh，且写在兜底规则之后', () => {
    const base = findRule(APP_CSS, 'html, body')
    const upgrade = findRule(APP_CSS, '@supports (height: 100dvh)')

    expect(heightValues(upgrade.body)).toEqual(['100dvh'])
    // 后写才能在同优先级下覆盖；否则支持 dvh 的引擎会退回 100%（PWA 动态视口语义丢失）。
    expect(upgrade.index).toBeGreaterThan(base.index)
  })

  it('升级块同时覆盖 html 与 body，避免两者高度来源不一致', () => {
    const upgrade = findRule(APP_CSS, '@supports (height: 100dvh)')
    expect(upgrade.body.replace(/\s+/g, ' ')).toContain('html, body {')
  })

  it('再不支持 dvh 的引擎上给外壳第二条高度锚点（@supports not 块，写在基础规则之后）', () => {
    const shellRules = findAllRules(APP_CSS, '.app-viewport')
    // 一条基础规则 + 一条外壳兜底规则
    expect(shellRules.length).toBeGreaterThanOrEqual(2)

    const base = shellRules[0]
    expect(heightValues(base.body)).toEqual(['100%'])

    const shellFallback = shellRules[shellRules.length - 1]
    expect(shellFallback.index).toBeGreaterThan(base.index)
    expect(heightValues(shellFallback.body)).toEqual(['100vh'])

    // 必须包在 `@supports not (height: 100dvh)` 里：写进基础规则会被构建器当冗余声明删掉。
    const supportsNotIndex = APP_CSS.lastIndexOf('@supports not (height: 100dvh)')
    expect(supportsNotIndex).toBeGreaterThan(-1)
    expect(supportsNotIndex).toBeLessThan(shellFallback.index)
  })

  it('兜底规则里的 overflow 与 dark 模式 color-scheme 块保持原样', () => {
    const base = findRule(APP_CSS, 'html, body')
    expect(base.body).toMatch(/overflow\s*:\s*hidden\s*;/)
    expect(base.body).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/)
    expect(base.body).toMatch(/color-scheme\s*:\s*dark\s*;/)
  })
})
