---
name: run-app
description: Launch and drive the Single-Cohort Flow Simulator locally — the FastAPI backend + the Next.js dashboard — and optionally browser-drive the whole UI end-to-end (first-run setup gate → dashboard Advisor → Bottlenecks Auto-fill → Apply) with Playwright + the system Chrome. Use when asked to run, start, screenshot, or smoke-test the app.
---

# Run the Single-Cohort Flow Simulator

Two processes: a FastAPI backend (port 8001) and the Next.js dashboard (port 3000).
The browser talks to the backend through Next's `/api/backend/*` rewrite, so there is no
CORS/auth to configure (auth was removed; every request is one shared demo user).

## Prerequisites (already true on the dev machine)
- `py -m pip install -r requirements.txt` (backend deps).
- `cd web && npm install` (frontend deps). **Playwright is already in `web/node_modules`** — the
  UI driver reuses it. No `npx playwright install` needed; it drives the *system* Chrome via
  `channel: "chrome"`.

## Launch

**Backend** (normal — uses the real, gitignored `data/app.db`, seeded on first boot):
```bash
py -m uvicorn src.api:app --port 8001 --log-level warning   # run in background
curl -s http://localhost:8001/health                        # {"status":"ok"} when ready
```

**Frontend**:
```bash
cd web && npm run dev                                        # run in background
# Ready in ~3s. OPEN http://localhost:3000 — NOT 127.0.0.1:3000
```
Next.js 16 dev mode blocks cross-origin dev requests from origins not in `allowedDevOrigins`, so
`127.0.0.1` fails where `localhost` works. First hit to each route triggers on-demand compile
(a few seconds) — give selectors generous timeouts.

## Gotchas learned the hard way
- **The seed config ships a *populated* `initial_state`**, so the first-run setup gate is
  correctly *skipped* on a normal boot — you land straight on the dashboard. To actually exercise
  the gate you need BOTH: (a) blank the initial state, and (b) a fresh browser context (the gate
  also checks a `localStorage` flag `initial-state-setup-done`). The driver's `TEST_GATE=1` mode
  does (a) for you; a fresh Playwright context gives (b) automatically.
  ```bash
  curl -s -X PUT http://localhost:8001/config -H "Content-Type: application/json" \
    -d '{"initial_state":{"occupancy":{}}}'
  ```
- **Isolate the DB when testing** so you never mutate `data/app.db`: start the backend with
  `DATABASE_URL="sqlite:///<abs-temp-path>.db"` — it seeds fresh from the JSON files.
- **Shut down** by killing whatever is LISTENING on 8001 / 3000 (on Windows:
  `netstat -ano | grep LISTENING | grep :PORT` → `taskkill //PID <pid> //F`).

## Drive the UI (Playwright)
`drive_ui.mjs` (in this skill dir) launches headless Chrome, walks the full flow, and writes
numbered screenshots. **Run it from `web/`** so it resolves `playwright` from `web/node_modules`:
```bash
cd web && OUT_DIR=/some/scratch TEST_GATE=1 node ../.claude/skills/run-app/drive_ui.mjs
```
Env: `BASE_URL` (default `http://localhost:3000`), `API_URL` (default `http://localhost:8001`),
`OUT_DIR` (where screenshots go, default the OS temp dir), `TEST_GATE=1` (blank initial_state via
the API first so the setup gate appears). It prints `[PASS]/[FAIL]` per step and exits non-zero on
any failure. **Always open the screenshots and look** — a passing assertion on a blank frame is
still a failed launch.

## Non-browser checks (faster, no servers needed)
- `py -m pytest tests/ -v` — full suite (~3 min, 148 tests).
- `cd web && npx tsc --noEmit -p .` — typecheck the dashboard.
- `validate_api.py` (in this skill dir) — in-process API smoke test against a throwaway DB
  (exercises `/meta`, `/simulate`, `/autofill`, `/config` + 422 validation). Run from the repo
  root with `PYTHONPATH` set to the repo root.
