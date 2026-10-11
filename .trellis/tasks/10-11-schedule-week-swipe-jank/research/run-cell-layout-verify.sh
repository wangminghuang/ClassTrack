#!/usr/bin/env bash
# 在 360 / 412 / 1440 三个视口上跑课程格文字适配回归（1x 与 2x、跨周）。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT"
export PATH=/home/yetongy/.npm-global/bin:$PATH TMPDIR=/tmp/claude XDG_RUNTIME_DIR=/tmp/ab-week-jank AGENT_BROWSER_SESSION=week-jank
mkdir -p "$TMPDIR" "$XDG_RUNTIME_DIR"
python3 -m http.server 5174 --bind 127.0.0.1 --directory build/client > /tmp/claude/week-server.log 2>&1 & SERVER=$!
trap 'agent-browser close >/dev/null 2>&1 || true; kill $SERVER 2>/dev/null || true' EXIT
agent-browser --executable-path /usr/bin/google-chrome open http://127.0.0.1:5174/
node -e 'const fs=require("fs");const s={};new Function("localStorage",fs.readFileSync(process.argv[1],"utf8"))({setItem:(k,v)=>s[k]=String(v),getItem:()=>null});fs.writeFileSync("/tmp/claude/week-seed.json",s["class-track-storage"])' .trellis/tasks/archive/2026-09/09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js
agent-browser set viewport 412 731 2
agent-browser storage local set class-track-storage "$(cat /tmp/claude/week-seed.json)"
agent-browser reload
agent-browser wait '[data-course-cell]'
OUT=${1:-/tmp/claude/cell-layout.json}
mkdir -p "$(dirname "$OUT")"
for VIEW in "360 794 2" "412 731 2" "1440 900 1"; do
  set -- $VIEW
  agent-browser set viewport "$1" "$2" "$3"
  sleep 1
  WS=$(agent-browser get cdp-url)
  PORT=$(echo "$WS" | sed -E 's#ws://[^:]+:([0-9]+)/.*#\1#')
  curl -s "http://127.0.0.1:$PORT/json/list" > /tmp/claude/week-targets.json
  PAGE_WS=$(node -e 'const a=require("/tmp/claude/week-targets.json");console.log(a.find(t=>t.type==="page").webSocketDebuggerUrl)')
  node .trellis/tasks/10-11-schedule-week-swipe-jank/research/verify-cell-layout.mjs "$PAGE_WS" "$OUT.$1x$2"
done
echo "cell layout verify finished: $OUT.{360x794,412x731,1440x900}"
