#!/usr/bin/env bash
# 缩小覆盖 / 无模糊 / 三入口 / 减少动效验收。前置：先 pnpm build。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT"
export PATH=/home/yetongy/.npm-global/bin:$PATH TMPDIR=/tmp/claude XDG_RUNTIME_DIR=/tmp/ab-zoom-coverage AGENT_BROWSER_SESSION=zoom-coverage
mkdir -p "$TMPDIR" "$XDG_RUNTIME_DIR"
python3 -m http.server 5177 --bind 127.0.0.1 --directory build/client > /tmp/claude/zoom-coverage-server.log 2>&1 & SERVER=$!
trap 'agent-browser close >/dev/null 2>&1 || true; kill $SERVER 2>/dev/null || true' EXIT
agent-browser --executable-path /usr/bin/google-chrome open http://127.0.0.1:5177/
agent-browser set viewport 412 731 2
node -e 'const fs=require("fs");const s={};new Function("localStorage",fs.readFileSync(process.argv[1],"utf8"))({setItem:(k,v)=>s[k]=String(v),getItem:()=>null});fs.writeFileSync("/tmp/claude/zoom-coverage-seed.json",s["class-track-storage"])' .trellis/tasks/archive/2026-09/09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js
agent-browser storage local set class-track-storage "$(cat /tmp/claude/zoom-coverage-seed.json)"
agent-browser reload
agent-browser wait '[data-course-cell]'
WS=$(agent-browser get cdp-url)
PORT=$(echo "$WS" | sed -E 's#ws://[^:]+:([0-9]+)/.*#\1#')
curl -s "http://127.0.0.1:$PORT/json/list" > /tmp/claude/zoom-coverage-targets.json
PAGE_WS=$(node -e 'const a=require("/tmp/claude/zoom-coverage-targets.json");console.log(a.find(t=>t.type==="page").webSocketDebuggerUrl)')
DIR=.trellis/tasks/11-06-schedule-zoom-out-blank/research
node "$DIR/verify-zoom-coverage.mjs" "$PAGE_WS" "${1:-$DIR/zoom-coverage.json}" "${2:-$DIR/zoom-out-preview.png}"
