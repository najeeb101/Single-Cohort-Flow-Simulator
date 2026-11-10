#!/usr/bin/env bash
# Start the public demo from this PC and publish its (changing) tunnel URL to the stable
# GitHub Pages link. Usage: scripts/public_demo.sh start | stop
# Needs: docker, cloudflared, git push access. Run from anywhere inside the repo.
set -euo pipefail
cd "$(dirname "$0")/.."
LOG="${TMPDIR:-/tmp}/cs-demo-tunnel.log"

publish() {  # $1 = online true/false, $2 = url
  printf '{"online": %s, "url": "%s"}\n' "$1" "$2" > docs/demo.json
  git add docs/demo.json
  git diff --cached --quiet || { git commit -qm "demo link: $1" && git push -q; }
}

case "${1:-start}" in
  start)
    docker image inspect cs-intake-planner >/dev/null 2>&1 || docker build -t cs-intake-planner .
    docker start cs-demo >/dev/null 2>&1 || docker run -d --name cs-demo --restart unless-stopped \
      -p 127.0.0.1:7860:7860 cs-intake-planner >/dev/null
    for _ in $(seq 1 40); do curl -sf http://127.0.0.1:7860/api/backend/health >/dev/null && break; sleep 3; done
    rm -f "$LOG"
    nohup cloudflared tunnel --url http://127.0.0.1:7860 --no-autoupdate --protocol http2 \
      --logfile "$LOG" >/dev/null 2>&1 &
    URL=""
    for _ in $(seq 1 30); do
      URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1 || true)
      [ -n "$URL" ] && grep -q "Registered tunnel connection" "$LOG" && break
      sleep 2
    done
    [ -n "$URL" ] || { echo "tunnel did not start; see $LOG" >&2; exit 1; }
    publish true "$URL"
    echo "Live: $URL  (stable link: https://najeeb101.github.io/Single-Cohort-Flow-Simulator/)"
    ;;
  stop)
    publish false ""
    powershell.exe -NoProfile -Command "Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force" || true
    docker stop cs-demo >/dev/null 2>&1 || true
    echo "Demo stopped; the stable link now shows the offline page."
    ;;
  *) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac
