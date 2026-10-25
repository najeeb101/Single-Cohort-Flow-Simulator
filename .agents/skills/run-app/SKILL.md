---
name: run-app
description: Launch and drive the CS Intake Planner locally — the FastAPI backend + the Next.js website — and optionally browser-drive the whole UI end-to-end (first-run setup gate → Run analysis → recommendation → seat plan → Apply → other pages → Advisor) with Playwright + the system Chrome. Use when asked to run, start, screenshot, or smoke-test the app.
---

# Run the Single-Cohort Flow Simulator

Two processes: a FastAPI backend (port 8001) and the Next.js dashboard (port 3000).
The browser talks to the backend through Next's `/api/backend/*` rewrite, so there is no
CORS/auth to configure (auth was removed; every request is one shared demo user).

## Prerequisites (already true on the dev machine)
- `py -m pip install -r requirements.txt` (backend deps).
- `cd web && npm install` (frontend deps). **Playwright is NOT a `web/` dependency** (it isn't in
  `package.json`, and on the department laptop it isn't installed). Add it without touching
  `package.json`, ideally into the isolated copy you drive (see Gotchas):
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save playwright@1.55.0`. No
  `npx playwright install` needed with `CHROME_CHANNEL=chrome` (drives the *system* Chrome).

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
- **The first-run setup gate shows while past intakes are empty or still tagged estimate** (true
  for the shipped seed config) **and** the `localStorage` flag `initial-state-setup-done` isn't
  set. A fresh Playwright context has no flag, so `TEST_GATE=1` just skips pre-setting it (and the
  intro flag); without `TEST_GATE` the driver pre-sets both and lands straight on the planner.
- **Isolate the DB when testing** so you never mutate `data/app.db`: start the backend with
  `DATABASE_URL="sqlite:///<abs-temp-path>.db"` — it seeds fresh from the JSON files.
- **Shut down** by killing whatever is LISTENING on 8001 / 3000 (on Windows:
  `netstat -ano | grep LISTENING | grep :PORT` → `taskkill //PID <pid> //F`).
- **If 3000/8001 are already LISTENING, that's very likely the user's own live session** (check
  `netstat` before assuming the ports are free) — don't kill it and don't create/advance/discard
  its checkpoint session (there's only one shared demo user, so that state is real, not a
  fixture). Instead run a fully isolated pair on different ports: backend on another port with
  its own `DATABASE_URL`, and for the frontend, Next.js/Turbopack **refuses a second `next dev`
  from the same project directory** ("Another next dev server is already running", naming the
  live PID) — you have to `robocopy` `web/` (source + a **real copy** of `node_modules`, not a
  symlink/junction: Turbopack's resolver rejects a `node_modules` symlink that points outside the
  copy's own tree) to a **short** path and run `next dev -p <port>` from there with
  `NEXT_PUBLIC_API_BASE` pointed at the isolated backend. The copy's path must stay short —
  Turbopack writes long generated cache filenames under `.next/dev/...` and a deeply nested temp
  path (e.g. this harness's default scratchpad dir) blows past Windows' filesystem path-length
  limit and crashes with a `TurbopackInternalError`/`path length ... exceeds max length`; a
  top-level path like `C:\wtest` works. Clean up the copy and kill the isolated PIDs when done.

## Drive the UI (Playwright)
`drive_ui.mjs` (in this skill dir) launches headless Chrome, walks the full flow, and writes
numbered screenshots. **Run it from `web/`** so it resolves `playwright` from `web/node_modules`:
```bash
cd web && OUT_DIR=/some/scratch TEST_GATE=1 node ../.claude/skills/run-app/drive_ui.mjs
```
Env: `BASE_URL` (default `http://localhost:3000`), `API_URL` (default `http://localhost:8001`),
`OUT_DIR` (where screenshots go, default the OS temp dir), `TEST_GATE=1` (go through the intro and
setup gate), `CHROME_CHANNEL=chrome` (system Chrome), `ASK_ADVISOR=0` (skip the chat question).
It shrinks the analysis grid via `PUT /config` first, so only run it against an isolated DB. It prints `[PASS]/[FAIL]` per step and exits non-zero on
any failure. **Always open the screenshots and look** — a passing assertion on a blank frame is
still a failed launch.

## Non-browser checks (faster, no servers needed)
- `py -m pytest tests/ -v` — full suite (~280 tests, 2-4 min).
- `cd web && npx tsc --noEmit -p .` — typecheck the dashboard.
- `validate_api.py` (in this skill dir) — in-process API smoke test against a throwaway DB
  (exercises `/meta`, `/simulate`, `/intake-analyses` (sweep + seat plan), `/config` + 422 validation). Run from the repo
  root with `PYTHONPATH` set to the repo root.
