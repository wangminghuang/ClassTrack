import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 构建产物的视口高度锚点守卫。
 *
 * 背景（任务 `09-29-fix-schedule-scroll-legacy-webview`）：`app/app.css` 里 `html, body` 的高度写成
 * `height: 100%` + `height: 100dvh` 两行兜底时，Tailwind v4 的 lightningcss 会把前一条当「被后一条
 * 覆盖的冗余声明」删掉，产物里只剩 `dvh`。于是不认识 `dvh` 的 WebView（Chromium ≤ 107 / Safari < 15.4）
 * 上 `html/body` 变成 `height: auto`，应用外壳整条 `height:100%` 链失去锚点 —— 课表区域
 * `scrollHeight == clientHeight`、**完全无法上下滑动**，且溢出部分被 `overflow: hidden` 裁掉。
 *
 * 这条回归没有任何运行时报错，所以必须按**真产物**断言一次。源码侧的结构断言见
 * `app/appCssViewportAnchor.test.ts`。
 *
 * 断言的三条性质（缺一不可）：
 * 1. 存在 `dvh` 升级块：`@supports (height: 100dvh) { html, body { height: 100dvh } }`；
 * 2. 存在**在升级块之外**的兜底：`html, body { … height: 100% … }`（写在块内等于只对支持 `dvh` 的引擎生效，救不了旧引擎）；
 * 3. 兜底规则出现在升级块之前（同优先级下后写者胜，顺序颠倒会让支持 `dvh` 的引擎也退回 `100%`）。
 * 4. 应用外壳也有一条只对「没有 `dvh` 的引擎」生效的兜底：`@supports not (height: 100dvh)` 里给
 *    `.app-viewport` 设 `100vh` —— 高度锚点不得单点依赖 `html/body`。
 */
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_ASSETS_DIR = join(ROOT_DIR, 'build', 'client', 'assets')

const TARGET_SELECTOR = 'html, body'
const DVH_SUPPORTS_HEADER = /@supports\s*\(\s*height\s*:\s*100dvh\s*\)\s*\{/
/** `height: 100%` / `height: 100dvh` 这类声明；`(?<![\w-])` 排除 `min-height` / `max-height`。 */
/**
 * `height: 100%` / `height: 100dvh` 这类声明。
 *
 * - `(?<![\w-])` 排除 `min-height` / `max-height`（它们救不了视口高度锚点）；
 * - 结尾允许 `;` / `}` / 字符串结束 —— 规则体被单独切出来时最后一条声明没有分号。
 */
const heightDeclaration = (value) => new RegExp(`(?<![\\w-])height\\s*:\\s*${value}\\s*(?:[;}]|$)`)

const HAS_FALLBACK_DECLARATION = heightDeclaration('100%')
const HAS_DVH_DECLARATION = heightDeclaration('100dvh')
const HAS_VH_DECLARATION = heightDeclaration('100vh')

/** 应用外壳：高度锚点不得单点依赖 `html/body`，它自己也有一条 `100vh` 兜底（见下面的 `@supports not`）。 */
const SHELL_SELECTOR = '.app-viewport'
/** `@supports not (height: 100dvh)`：只在不支持 `dvh` 的引擎上生效的外壳兜底块。 */
const DVH_SUPPORTS_NOT_HEADER = /@supports\s+not\s*\(\s*height\s*:\s*100dvh\s*\)\s*\{/

/**
 * 从 `headerPattern` 命中处开始做花括号配对，返回整块（含头部与最外层花括号）。
 *
 * @param {string} css 样式文本。
 * @param {RegExp} headerPattern 形如 `…{` 的头部正则。
 * @param {number} [from] 起始搜索下标。
 * @returns {{ start: number, end: number, body: string } | null}
 */
/**
 * 从 `{` 开始做花括号配对。
 *
 * @param {string} css 样式文本。
 * @param {number} openIndex `{` 的下标。
 * @returns {{ end: number, body: string } | null} `end` 是右花括号下标 + 1。
 */
function readBlockAt(css, openIndex) {
  let depth = 0
  for (let index = openIndex; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return { end: index + 1, body: css.slice(openIndex + 1, index) }
    }
  }

  return null
}

/**
 * 从 `headerPattern` 命中处开始读出整块（含头部与最外层花括号）。
 *
 * @param {string} css 样式文本。
 * @param {RegExp} headerPattern 形如 `…{` 的头部正则。
 * @returns {{ start: number, end: number, body: string } | null}
 */
function readBlock(css, headerPattern) {
  const match = new RegExp(headerPattern.source).exec(css)
  if (!match) return null

  const block = readBlockAt(css, match.index + match[0].length - 1)
  return block ? { start: match.index, end: block.end, body: block.body } : null
}

/**
 * 找到**真正承担 `html, body` 高度升级**的那个 `@supports (height: 100dvh)` 块。
 *
 * 不能只取第一个命中：Tailwind 会为 `supports-[height:100dvh]:h-dvh` 这类工具类生成同名的
 * `@supports (height:100dvh)` 块，它在产物里的相对位置会随样式表增长而改变（合并 master 后
 * 那个工具类块就排到了 `html/body` 升级块之前）。只看第一个命中会把升级块误判成缺失，
 * 于是守卫在产物完全正常时变红。
 *
 * @param {string} css 样式文本。
 * @returns {{ start: number, end: number, body: string, rules: Array<{ index: number, body: string }> } | null}
 */
function findDvhUpgradeBlock(css) {
  let cursor = 0

  while (cursor < css.length) {
    const match = new RegExp(DVH_SUPPORTS_HEADER.source).exec(css.slice(cursor))
    if (!match) return null

    const start = cursor + match.index
    const block = readBlockAt(css, start + match[0].length - 1)
    if (!block) return null

    const rules = scanRuleBodies(block.body)
    if (rules.some((rule) => HAS_DVH_DECLARATION.test(rule.body))) {
      return { start, end: block.end, body: block.body, rules }
    }

    cursor = block.end
  }

  return null
}

/**
 * 扫描选择器（空白归一化后）等于 `selector` 的规则，返回每个规则的选择器起点与规则体。
 * 压缩与未压缩写法都能命中，且会一并返回嵌套在 `@supports` / `@media` 里的同名规则。
 *
 * @param {string} css 样式文本。
 * @param {string} selector 目标选择器（如 `html, body`；压缩产物的 `html,body` 也算命中）。
 * @returns {Array<{ index: number, body: string }>}
 */
export function scanRuleBodies(css, selector = TARGET_SELECTOR) {
  const wanted = normalizeSelector(selector)
  const found = []

  let cursor = 0
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor)
    if (open === -1) break

    // 选择器总是紧跟在 `{` / `}` / `;` 之后，三者取最近的一个作为边界（`{` 覆盖了嵌套在
    // `@layer` / `@supports` / `@media` 里的规则）。
    const boundary = Math.max(css.lastIndexOf('}', open - 1), css.lastIndexOf(';', open - 1), css.lastIndexOf('{', open - 1))
    const candidate = normalizeSelector(css.slice(boundary + 1, open))

    if (candidate === wanted) {
      const block = readBlockAt(css, open)
      if (!block) break

      found.push({ index: boundary + 1, body: block.body })
      cursor = block.end
      continue
    }

    cursor = open + 1
  }

  return found
}

/**
 * 选择器归一化：空白折叠 + 逗号两侧去空白。
 *
 * 压缩产物里写的是 `html,body{…}`，未压缩的是 `html,\nbody {…}`，两者都归一化成 `html,body`。
 *
 * @param {string} value 原始选择器文本。
 * @returns {string}
 */
function normalizeSelector(value) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .trim()
}

/**
 * 在一份 CSS 文本里找视口高度锚点的三个组成部分。
 *
 * @param {string} css 样式文本（压缩或未压缩都可）。
 * @returns {{ hasFallback: boolean, hasDvhUpgrade: boolean, hasDvh: boolean, fallbackBeforeUpgrade: boolean, hasShellFallback: boolean }}
 */
export function findViewportHeightAnchor(css) {
  const upgrade = findDvhUpgradeBlock(css)
  const upgradeRules = upgrade ? upgrade.rules : []

  // 兜底必须在升级块之外：只把兜底写进 @supports 等于「只对支持 dvh 的引擎生效」，救不了旧引擎。
  // 用等长空白抹掉升级块（而不是拼接切片），这样规则下标仍与原文本一一对应，顺序判定才准。
  const outsideUpgrade = upgrade ? css.slice(0, upgrade.start) + ' '.repeat(upgrade.end - upgrade.start) + css.slice(upgrade.end) : css
  const fallbackRules = scanRuleBodies(outsideUpgrade).filter((rule) => HAS_FALLBACK_DECLARATION.test(rule.body))

  // 外壳锚点：`.app-viewport` 自己也要有一条只在「没有 dvh」的引擎上生效的高度兜底，
  // 否则 `html/body` 那层一旦失效，整条高度链会一起塌（全站内部滚动区失效）。
  const shellFallback = readBlock(css, DVH_SUPPORTS_NOT_HEADER)
  const hasShellFallback =
    shellFallback !== null && scanRuleBodies(shellFallback.body, SHELL_SELECTOR).some((rule) => HAS_VH_DECLARATION.test(rule.body))

  return {
    hasFallback: fallbackRules.length > 0,
    hasDvhUpgrade: upgradeRules.some((rule) => HAS_DVH_DECLARATION.test(rule.body)),
    hasDvh: HAS_DVH_DECLARATION.test(css),
    fallbackBeforeUpgrade: Boolean(upgrade) && fallbackRules.every((rule) => rule.index < upgrade.start),
    hasShellFallback,
  }
}

/**
 * 断言一份 CSS 文本同时具备兜底与 `dvh` 升级。
 *
 * @param {string} css 样式文本。
 * @param {string} label 报错时用的来源标识。
 * @returns {{ hasFallback: boolean, hasDvhUpgrade: boolean, hasDvh: boolean, fallbackBeforeUpgrade: boolean, hasShellFallback: boolean }}
 */
export function assertViewportHeightAnchor(css, label = 'css') {
  const found = findViewportHeightAnchor(css)

  if (!found.hasFallback) {
    throw new Error(
      `${label}: 缺少 html,body 的 height:100% 兜底（构建器很可能又把它当冗余声明删了）—— ` +
        '不支持 dvh 的 WebView（Chromium ≤ 107）上应用会失去视口高度锚点，课表完全无法上下滑动'
    )
  }
  if (!found.hasDvhUpgrade) {
    throw new Error(
      `${label}: 缺少 @supports (height: 100dvh) { html, body { height: 100dvh } } 升级块 —— ` +
        '同一条规则里双写 height 会被构建器删掉前一条，必须用独立 @supports 块升级'
    )
  }
  if (!found.fallbackBeforeUpgrade) {
    throw new Error(`${label}: height:100% 兜底出现在了 dvh 升级块之后 —— 同优先级下后写者胜，dvh 会被兜底覆盖掉`)
  }
  if (!found.hasShellFallback) {
    throw new Error(
      `${label}: 缺少 @supports not (height: 100dvh) { .app-viewport { height: 100vh } } 外壳锚点 —— ` +
        '高度锚点不得单点依赖 html/body，否则那层失效时全站内部滚动区会跟着一起失效'
    )
  }

  return found
}

/**
 * 读取构建产物里的 CSS 文件。
 *
 * @param {{ assetsDir?: string }} [options] 允许测试注入目录。
 * @returns {Array<{ name: string, css: string }>}
 */
export function readBuildStyles({ assetsDir = BUILD_ASSETS_DIR } = {}) {
  if (!existsSync(assetsDir)) {
    throw new Error(`找不到构建产物目录 ${relative(ROOT_DIR, assetsDir)} —— 请先跑 pnpm build`)
  }

  const names = readdirSync(assetsDir).filter((name) => name.endsWith('.css'))
  if (names.length === 0) {
    throw new Error(`${relative(ROOT_DIR, assetsDir)} 里没有 CSS 产物 —— 请先跑 pnpm build`)
  }

  return names.map((name) => ({ name, css: readFileSync(join(assetsDir, name), 'utf8') }))
}

/**
 * 守卫入口：检查构建产物里的每份 CSS 都带着视口高度锚点。
 *
 * @param {{ assetsDir?: string }} [options] 允许测试注入目录。
 * @returns {{ anchorFile: string, styles: Array<{ name: string, hasFallback: boolean, hasDvhUpgrade: boolean, hasDvh: boolean, fallbackBeforeUpgrade: boolean, hasShellFallback: boolean }> }}
 */
export function checkWebviewCssFallback(options) {
  const styles = readBuildStyles(options)
  const checked = styles.map(({ name, css }) => ({
    name,
    ...assertViewportHeightAnchor(css, `build/client/assets/${name}`),
  }))

  return { anchorFile: checked[0].name, styles: checked }
}

const currentModulePath = resolve(fileURLToPath(import.meta.url))
const invokedModulePath = process.argv[1] ? resolve(process.argv[1]) : null

if (invokedModulePath === currentModulePath) {
  try {
    const result = checkWebviewCssFallback()
    console.log(
      `WebView CSS fallback check passed: ${result.styles.length} stylesheet(s), anchor in ${result.anchorFile} ` +
        '(html,body height:100% fallback outside the block + @supports (height:100dvh) upgrade + shell @supports not fallback)'
    )
  } catch (error) {
    console.error(`WebView CSS fallback check failed: ${error instanceof Error ? error.message : 'unknown failure'}`)
    process.exitCode = 1
  }
}
