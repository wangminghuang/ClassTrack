import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  assertViewportHeightAnchor,
  checkWebviewCssFallback,
  findViewportHeightAnchor,
  scanRuleBodies,
} from './check-webview-css-fallback.js'

/** 期望的真产物形态（压缩后，带上构建产物里的 `@layer` 前缀噪声）。 */
const PASSING_CSS =
  '@layer theme,base,components,utilities;' +
  'html,body{background-color:#fff;height:100%;overflow:hidden}' +
  '@supports (height:100dvh){html,body{height:100dvh}}' +
  // 外壳兜底块：真实产物里它落在 `@layer utilities` 内（只在没有 dvh 的引擎上生效）
  '@layer utilities{.app-viewport{height:100%;min-height:0}' +
  '@supports not (height:100dvh){.app-viewport{height:100vh;max-height:100vh}}}'

test('接受「块外 height:100% 兜底 + @supports 升级」的真产物形态', () => {
  assert.deepEqual(findViewportHeightAnchor(PASSING_CSS), {
    hasFallback: true,
    hasDvhUpgrade: true,
    hasDvh: true,
    fallbackBeforeUpgrade: true,
    hasShellFallback: true,
  })
  assert.doesNotThrow(() => assertViewportHeightAnchor(PASSING_CSS, 'fixture'))
})

test('忽略工具类生成的同名 @supports 块：它可能排在 html/body 升级块之前', () => {
  // Tailwind 为 `supports-[height:100dvh]:h-dvh` 会生成一个同名 `@supports (height:100dvh)` 块，
  // 它在产物里的位置会随样式表增长而改变。守卫必须按「块里有没有 html,body 的 dvh 升级」来认，
  // 不能只认第一个命中 —— 合并 master 后真实产物就是这种形态，旧写法在这里会误报。
  const utilityBlockFirst =
    '@supports (height:100dvh){.util-h-dvh{height:100dvh}}' +
    'html,body{height:100%}' +
    '@supports (height:100dvh){html,body{height:100dvh}}' +
    '@supports not (height:100dvh){.app-viewport{height:100vh}}'

  assert.deepEqual(findViewportHeightAnchor(utilityBlockFirst), {
    hasFallback: true,
    hasDvhUpgrade: true,
    hasDvh: true,
    fallbackBeforeUpgrade: true,
    hasShellFallback: true,
  })
  assert.doesNotThrow(() => assertViewportHeightAnchor(utilityBlockFirst, 'fixture'))
})

test('工具类同名块不能冒充升级块：只有它时仍要报错', () => {
  const utilityBlockOnly =
    '@supports (height:100dvh){.util-h-dvh{height:100dvh}}' +
    'html,body{height:100%}' +
    '@supports not (height:100dvh){.app-viewport{height:100vh}}'

  assert.equal(findViewportHeightAnchor(utilityBlockOnly).hasDvhUpgrade, false)
  assert.throws(() => assertViewportHeightAnchor(utilityBlockOnly, 'fixture'), /升级块/)
})

test('拦住外壳锚点缺失（html/body 失效时无人兜底）', () => {
  const noShell = 'html,body{height:100%}@supports (height:100dvh){html,body{height:100dvh}}'
  assert.equal(findViewportHeightAnchor(noShell).hasShellFallback, false)
  assert.throws(() => assertViewportHeightAnchor(noShell, 'fixture'), /外壳锚点/)
})

test('外壳兜底块必须真的给 .app-viewport 设 100vh（不是只写了个 @supports not 壳）', () => {
  const emptyShellBlock =
    'html,body{height:100%}@supports (height:100dvh){html,body{height:100dvh}}' +
    '@supports not (height:100dvh){.app-viewport{height:100%}}'
  assert.equal(findViewportHeightAnchor(emptyShellBlock).hasShellFallback, false)
})

test('拦住本次线上缺陷：兜底被构建器删掉、只剩 dvh', () => {
  const regressed = 'html,body{background-color:#fff;height:100dvh;overflow:hidden}'
  assert.equal(findViewportHeightAnchor(regressed).hasFallback, false)
  assert.throws(() => assertViewportHeightAnchor(regressed, 'fixture'), /height:100% 兜底/)
})

test('拦住往同一条规则里双写 height 的写法（产物里没有 @supports 块）', () => {
  const doubleWrite = 'html,body{height:100%;height:100dvh;overflow:hidden}'
  assert.equal(findViewportHeightAnchor(doubleWrite).hasFallback, true)
  assert.equal(findViewportHeightAnchor(doubleWrite).hasDvhUpgrade, false)
  assert.throws(() => assertViewportHeightAnchor(doubleWrite, 'fixture'), /升级块/)
})

test('拦住把兜底也写进 @supports 的写法（那只对支持 dvh 的引擎生效）', () => {
  const insideOnly = '@supports (height:100dvh){html,body{height:100%;height:100dvh}}'
  assert.equal(findViewportHeightAnchor(insideOnly).hasFallback, false)
  assert.throws(() => assertViewportHeightAnchor(insideOnly, 'fixture'), /height:100% 兜底/)
})

test('拦住顺序颠倒：兜底写在升级块之后会让 dvh 被兜底覆盖', () => {
  const reversed = '@supports (height:100dvh){html,body{height:100dvh}}html,body{height:100%}'
  assert.equal(findViewportHeightAnchor(reversed).hasDvhUpgrade, true)
  assert.equal(findViewportHeightAnchor(reversed).fallbackBeforeUpgrade, false)
  assert.throws(() => assertViewportHeightAnchor(reversed, 'fixture'), /升级块之后/)
})

test('不把 min-height / max-height 当成兜底', () => {
  const minOnly = 'html,body{min-height:100%;overflow:hidden}@supports (height:100dvh){html,body{height:100dvh}}'
  assert.equal(findViewportHeightAnchor(minOnly).hasFallback, false)
})

test('压缩与未压缩（prettier 换行）写法都能识别', () => {
  const pretty = [
    'html,',
    'body {',
    '  background-color: #fff;',
    '  height: 100%;',
    '  overflow: hidden;',
    '}',
    '',
    '@supports (height: 100dvh) {',
    '  html,',
    '  body {',
    '    height: 100dvh;',
    '  }',
    '}',
    '@layer utilities {',
    '  .app-viewport {',
    '    height: 100%;',
    '    min-height: 0;',
    '  }',
    '',
    '  @supports not (height: 100dvh) {',
    '    .app-viewport {',
    '      height: 100vh;',
    '      max-height: 100vh;',
    '    }',
    '  }',
    '}',
  ].join('\n')

  assert.deepEqual(findViewportHeightAnchor(pretty), {
    hasFallback: true,
    hasDvhUpgrade: true,
    hasDvh: true,
    fallbackBeforeUpgrade: true,
    hasShellFallback: true,
  })
})

test('scanRuleBodies 只认 html, body，压缩与换行两种写法都命中', () => {
  assert.equal(scanRuleBodies('html,body{height:100%}').length, 1)
  assert.equal(scanRuleBodies('html,\nbody {\n  height: 100%;\n}').length, 1)
  assert.equal(scanRuleBodies('.foo{height:100%}').length, 0)
})

test('产物目录缺失时明确要求先跑 pnpm build', () => {
  assert.throws(() => checkWebviewCssFallback({ assetsDir: join(tmpdir(), '__classtrack_missing_assets__') }), /pnpm build/)
})

test('产物目录里没有 CSS 时同样要求先跑 pnpm build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classtrack-css-'))
  try {
    writeFileSync(join(dir, 'index.html'), '<html></html>')
    assert.throws(() => checkWebviewCssFallback({ assetsDir: dir }), /pnpm build/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('产物 CSS 缺锚点时按文件名报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classtrack-css-'))
  try {
    writeFileSync(join(dir, 'root-abc123.css'), 'html,body{height:100dvh;overflow:hidden}')
    assert.throws(() => checkWebviewCssFallback({ assetsDir: dir }), /root-abc123\.css/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('产物 CSS 完整时给出锚点文件名', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classtrack-css-'))
  try {
    writeFileSync(join(dir, 'root-abc123.css'), PASSING_CSS)
    const result = checkWebviewCssFallback({ assetsDir: dir })
    assert.equal(result.anchorFile, 'root-abc123.css')
    assert.equal(result.styles.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
