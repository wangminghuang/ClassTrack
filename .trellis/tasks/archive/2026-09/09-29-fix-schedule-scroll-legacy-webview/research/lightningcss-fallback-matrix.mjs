/**
 * 兜底写法矩阵：把候选写法交给仓库里那份 lightningcss，用项目实际目标编译，
 * 断言 `height:100%` 兜底是否活到产物里。
 *
 * 背景：`app/app.css` 写的是 `height: 100%; height: 100dvh;`，构建产物里只剩 `height: 100dvh`
 * —— lightningcss 按当前目标把前一条当「被覆盖的冗余声明」删掉了。
 *
 * 用法（仓库根目录）：node <此文件>
 */
import { createRequire } from 'node:module'

const LIGHTNINGCSS_PKG = 'node_modules/.pnpm/lightningcss@1.32.0/node_modules/lightningcss/package.json'
const require = createRequire(new URL(`file://${process.cwd()}/${LIGHTNINGCSS_PKG}`))
const lightningcss = require('lightningcss')

const CASES = {
  'A 现状 height:100% + height:100dvh': 'html,body{height:100%;height:100dvh;overflow:hidden}',
  'B height:100% + @supports(height:100dvh)': 'html,body{height:100%;overflow:hidden}@supports (height:100dvh){html,body{height:100dvh}}',
  'C height:100vh + height:100dvh': 'html,body{height:100vh;height:100dvh;overflow:hidden}',
  'D height:100dvh + height:100%（颠倒）': 'html,body{height:100dvh;height:100%;overflow:hidden}',
  'E 拆到 html / body 两个选择器': 'html{height:100%}body{height:100dvh}',
  'G height:100dvh + min-height:100%': 'html,body{height:100dvh;min-height:100%;overflow:hidden}',
}

const TARGETS = [
  ['默认（项目实际）', undefined],
  ['chrome 111', { chrome: 111 << 16 }],
  ['chrome 107（模拟旧 WebView）', { chrome: 107 << 16 }],
]

for (const [label, css] of Object.entries(CASES)) {
  for (const [targetLabel, targets] of TARGETS) {
    const out = lightningcss.transform({ filename: 't.css', code: Buffer.from(css), minify: true, targets }).code.toString()
    const keepsFallback = /height:100%(?!dvh)/.test(out) || /height:100vh/.test(out)
    console.log(`${label.padEnd(42)} ${targetLabel.padEnd(28)} 兜底保留=${String(keepsFallback).padEnd(5)} ${out}`)
  }
}

/** 分界线扫描：dvh 从哪个 Chrome 版本开始被当成「已支持」。 */
console.log('\n--- 兜底被删的版本分界线 ---')
let previous = null
for (let version = 96; version <= 118; version += 1) {
  const out = lightningcss.transform({
    filename: 't.css',
    code: Buffer.from(CASES['A 现状 height:100% + height:100dvh']),
    minify: true,
    targets: { chrome: version << 16 },
  }).code.toString()
  const keeps = out.includes('height:100%')
  if (previous === null || keeps !== previous) console.log(`chrome ${version} -> 保留兜底: ${keeps}`)
  previous = keeps
}
