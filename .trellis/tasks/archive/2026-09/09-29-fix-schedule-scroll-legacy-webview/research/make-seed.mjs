/**
 * 由归档夹具生成「CDP 灌种子」用的 init script。
 *
 * 为什么要绕这一圈：`seed-schedule-fixture.js` 里是中文 + 双引号，直接当 shell 参数传给
 * `agent-browser eval "$(cat …)"` 会被双引号展开吃掉反斜杠转义，写入不生效。
 * 这里把整份 localStorage 载荷做成百分号编码（只剩 %XX 与数字字母，无引号无反斜杠），
 * 运行时用 `decodeURIComponent` 还原。
 *
 * 用法：node <此文件> [输出路径]，默认 /tmp/ct-seed-write.js
 * 然后用：agent-browser --session <s> --init-script /tmp/ct-seed-write.js open http://localhost:5173/
 * （`--init-script` 在页面脚本之前执行，能避开「App 自己把空状态写回 localStorage」的竞态）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FIXTURE = '.trellis/tasks/archive/2026-09/09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js'
const OUT = process.argv[2] ?? '/tmp/ct-seed-write.js'

const store = new Map()
const fixture = readFileSync(FIXTURE, 'utf8')
new Function('localStorage', 'window', fixture)({ setItem: (key, value) => store.set(key, String(value)) }, {})

const persisted = JSON.parse(store.get('class-track-storage'))
persisted.version = 4
persisted.state.schemaVersion = 4

const encoded = encodeURIComponent(JSON.stringify(persisted))
writeFileSync(OUT, `localStorage.setItem('class-track-storage', decodeURIComponent('${encoded}'));\n`)
console.log(`wrote ${OUT} (${encoded.length} chars, payload ${JSON.stringify(persisted).length} chars)`)
