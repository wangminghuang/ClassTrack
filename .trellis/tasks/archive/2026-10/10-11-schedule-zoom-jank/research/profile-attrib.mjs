// 归因脚本：把 .cpuprofile 的「自身耗时」按函数与来源模块聚合。
// 用法：node .../profile-attrib.mjs <file.cpuprofile> [topN=25]
import { readFileSync } from 'node:fs'

const [file, topN = '25'] = process.argv.slice(2)
if (!file) throw new Error('需要 .cpuprofile 路径')
const profile = JSON.parse(readFileSync(file, 'utf8'))

// 总时长取 timeDeltas 之和（微秒），避免把「采样数 ≈ 毫秒数」当成事实。
const totalMs = (profile.timeDeltas ?? []).reduce((sum, delta) => sum + delta, 0) / 1000 || 1

// 每次采样属于一个节点；该节点的 hitCount 即自身采样数。
const self = new Map()
for (const node of profile.nodes) {
  const count = node.hitCount ?? 0
  if (count === 0) continue
  const frame = node.callFrame
  const key = `${frame.functionName || '(anonymous)'} @ ${(frame.url || '').split('/').pop()}:${frame.lineNumber + 1}`
  const entry = self.get(key) ?? { key, self: 0 }
  entry.self += count
  self.set(key, entry)
}
const total = [...self.values()].reduce((sum, entry) => sum + entry.self, 0) || 1

// 归入所属模块，判断热点是本项目代码还是引擎内置的布局/样式计算。
const byModule = new Map()
for (const entry of self.values()) {
  const module = entry.key.split(' @ ')[1]?.split(':')[0] || '(none)'
  byModule.set(module, (byModule.get(module) ?? 0) + entry.self)
}

const round = (value) => Math.round(value * 100) / 100
const top = [...self.values()].sort((a, b) => b.self - a.self).slice(0, Number(topN))
console.log(
  JSON.stringify(
    {
      totalMs: round(totalMs),
      totalSamples: total,
      topFunctions: top.map((entry) => ({ ...entry, selfMs: round((entry.self / total) * totalMs) })),
      topModules: [...byModule.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([module, count]) => ({ module, selfMs: round((count / total) * totalMs), percent: round((count / total) * 100) })),
    },
    null,
    2
  )
)
