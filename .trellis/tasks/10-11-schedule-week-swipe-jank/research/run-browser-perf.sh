#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT"
export PATH=/home/yetongy/.npm-global/bin:$PATH TMPDIR=/tmp/claude XDG_RUNTIME_DIR=/tmp/ab-week-jank AGENT_BROWSER_SESSION=week-jank
mkdir -p "$TMPDIR" "$XDG_RUNTIME_DIR"
python3 -m http.server 5174 --bind 127.0.0.1 --directory build/client > /tmp/claude/week-server.log 2>&1 & SERVER=$!
trap 'agent-browser close >/dev/null 2>&1 || true; kill $SERVER 2>/dev/null || true' EXIT
agent-browser --executable-path /usr/bin/google-chrome open http://127.0.0.1:5174/
agent-browser set viewport 412 731 2
node -e 'const fs=require("fs");const s={};new Function("localStorage",fs.readFileSync(process.argv[1],"utf8"))({setItem:(k,v)=>s[k]=String(v),getItem:()=>null});fs.writeFileSync("/tmp/claude/week-seed.json",s["class-track-storage"])' .trellis/tasks/archive/2026-09/09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js
agent-browser storage local set class-track-storage "$(cat /tmp/claude/week-seed.json)"
agent-browser reload
agent-browser wait '[data-course-cell]'
WS=$(agent-browser get cdp-url)
PORT=$(echo "$WS" | sed -E 's#ws://[^:]+:([0-9]+)/.*#\1#')
curl -s "http://127.0.0.1:$PORT/json/list" > /tmp/claude/week-targets.json
PAGE_WS=$(node -e 'const a=require("/tmp/claude/week-targets.json");console.log(a.find(t=>t.type==="page").webSocketDebuggerUrl)')
node .trellis/tasks/10-11-schedule-week-swipe-jank/research/week-switch-perf.mjs "$PAGE_WS" "${1:-4}" "${2:-/tmp/claude/week-perf.json}"
