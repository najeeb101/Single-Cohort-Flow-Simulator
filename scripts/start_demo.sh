#!/usr/bin/env bash
# Starts the public demo inside the container: the API on 127.0.0.1:8001 (never exposed) and the
# website on $PORT, which proxies /api/backend/* to it (web/next.config.ts). Exits if either dies,
# so the host restarts the whole container instead of leaving half a site up.
set -u
cd "$(dirname "$0")/.."

export DEMO_MODE="${DEMO_MODE:-1}"
# Free hosts have ~2 vCPUs; never fan the analysis wider than the machine.
export INTAKE_WORKERS="${INTAKE_WORKERS:-$(python -c 'import os; print(max(1, min(4, os.cpu_count() or 1)))')}"

python -m uvicorn src.api:app --host 127.0.0.1 --port 8001 &
API_PID=$!

# Wait for the API (first boot seeds the database) before opening the site.
for _ in $(seq 1 60); do
  python - <<'EOF' && break
import sys, urllib.request
try:
    urllib.request.urlopen("http://127.0.0.1:8001/health", timeout=2)
except Exception:
    sys.exit(1)
EOF
  sleep 1
done

(cd web && exec node node_modules/next/dist/bin/next start -p "${PORT:-7860}" -H 0.0.0.0) &
WEB_PID=$!

wait -n "$API_PID" "$WEB_PID"
echo "A server process exited; stopping the container." >&2
kill "$API_PID" "$WEB_PID" 2>/dev/null
exit 1
