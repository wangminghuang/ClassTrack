#!/usr/bin/env bash
# 手机课表缩放的静止态 / 降级验收（AC3 / AC4）：生产构建 + CDP 驱动三条入口。
# 用法：bash research/run-zoom-rest.sh [out.json]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT"
export PATH=/home/yetongy/.npm-global/bin:$PATH TMPDIR=/tmp/claude XDG_RUNTIME_DIR=/tmp/ab-zoom AGENT_BROWSER_SESSION=zoom-perf
mkdir -p "$TMPDIR" "$XDG_RUNTIME_DIR"
python3 -m http.server 5175 --bind 127.0.0.1 --directory build/client > /tmp/claude/zoom-server.log 2>&1 & SERVER=$!
trap 'agent-browser close >/dev/null 2>&1 || true; kill $SERVER 2>/dev/null || true' EXIT
agent-browser --executable-path /usr/bin/google-chrome open http://127.0.0.1:5175/
agent-browser set viewport 412 731 2
node -e 'const fs=require("fs");const s={};new Function("localStorage",fs.readFileSync(process.argv[1],"utf8"))({setItem:(k,v)=>s[k]=String(v),getItem:()=>null});fs.writeFileSync("/tmp/claude/zoom-seed.json",s["class-track-storage"])' .trellis/tasks/archive/2026-09/09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js
agent-browser storage local set class-track-storage "$(cat /tmp/claude/zoom-seed.json)"
agent-browser reload
agent-browser wait '[data-course-cell]'
WS=$(agent-browser get cdp-url)
PORT=$(echo "$WS" | sed -E 's#ws://[^:]+:([0-9]+)/.*#\1#')
curl -s "http://127.0.0.1:$PORT/json/list" > /tmp/claude/zoom-targets.json
PAGE_WS=$(node -e 'const a=require("/tmp/claude/zoom-targets.json");console.log(a.find(t=>t.type==="page").webSocketDebuggerUrl)')
node .trellis/tasks/10-11-schedule-zoom-jank/research/verify-zoom-rest.mjs "$PAGE_WS" "${1:-/tmp/claude/zoom-rest.json}"
