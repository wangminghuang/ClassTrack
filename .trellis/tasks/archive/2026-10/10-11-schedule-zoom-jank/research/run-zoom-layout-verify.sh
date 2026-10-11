#!/usr/bin/env bash
# 三档课程格适配回归：360 / 412 / 1440 三个视口，各跑 1x / 1.5x / 2x（桌面只有 1x/2x，见报告 summary.skipped）
# × 本周与跨周，逐格断言教室恒显、可丢行顺序、字号区间、文字块不溢出。
#
# 用法：bash .../run-zoom-layout-verify.sh [out.json]
# 前置：先 `pnpm build`（脚本只服务 build/client 产物，不跑 dev server）。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT"
export PATH=/home/yetongy/.npm-global/bin:$PATH TMPDIR=/tmp/claude XDG_RUNTIME_DIR=/tmp/ab-zoom-layout AGENT_BROWSER_SESSION=zoom-layout
mkdir -p "$TMPDIR" "$XDG_RUNTIME_DIR"
python3 -m http.server 5175 --bind 127.0.0.1 --directory build/client > /tmp/claude/zoom-layout-server.log 2>&1 & SERVER=$!
trap 'agent-browser close >/dev/null 2>&1 || true; kill $SERVER 2>/dev/null || true' EXIT
agent-browser --executable-path /usr/bin/google-chrome open http://127.0.0.1:5175/
node -e 'const fs=require("fs");const s={};new Function("localStorage",fs.readFileSync(process.argv[1],"utf8"))({setItem:(k,v)=>s[k]=String(v),getItem:()=>null});fs.writeFileSync("/tmp/claude/zoom-layout-seed.json",s["class-track-storage"])' .trellis/tasks/archive/2026-09/09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js
# 显式清一遍再灌种子：夹具里不含缩放档位，上一次会话留下的档位会变成「起点」，让标签名不副实。
agent-browser storage local clear
agent-browser set viewport 412 731 2
agent-browser storage local set class-track-storage "$(cat /tmp/claude/zoom-layout-seed.json)"
agent-browser reload
agent-browser wait '[data-course-cell]'
OUT=${1:-/tmp/claude/zoom-layout.json}
mkdir -p "$(dirname "$OUT")"
for VIEW in "360 794 2" "412 731 2" "1440 900 1"; do
  set -- $VIEW
  agent-browser set viewport "$1" "$2" "$3"
  sleep 1
  WS=$(agent-browser get cdp-url)
  PORT=$(echo "$WS" | sed -E 's#ws://[^:]+:([0-9]+)/.*#\1#')
  curl -s "http://127.0.0.1:$PORT/json/list" > /tmp/claude/zoom-layout-targets.json
  PAGE_WS=$(node -e 'const a=require("/tmp/claude/zoom-layout-targets.json");console.log(a.find(t=>t.type==="page").webSocketDebuggerUrl)')
  node .trellis/tasks/10-11-schedule-zoom-jank/research/verify-zoom-layout.mjs "$PAGE_WS" "$OUT.$1x$2" > "$OUT.$1x$2.log" 2>&1 \
    || { echo "✗ 视口 $1x$2 违约："; tail -30 "$OUT.$1x$2.log"; exit 1; }
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("  ✓", process.argv[2], "checks="+r.runs.length, "tiers="+[...new Set(r.runs.map(x=>x.zoom))].join(","), "violations="+r.violations.length)' "$OUT.$1x$2" "$1x$2"
done
echo "三档课程格回归通过：$OUT.{360x794,412x731,1440x900}"
