# Deployment (Render, free tier)

The repo includes `render.yaml` at the root — a Render "Blueprint" that provisions all three
pieces this app needs (FastAPI backend, Next.js frontend, Postgres database) from one file, with
the env vars that connect them already wired up. No Docker, no manual per-service config.

## One-time setup

1. Push this repo to GitHub if you haven't already (`origin` is already configured —
   `git push origin main`).
2. Go to [render.com](https://render.com) and sign in with your GitHub account.
3. Click **New +** → **Blueprint**.
4. Select the `najeeb101/Single-Cohort-Flow-Simulator` repo.
5. Render reads `render.yaml` and shows the three services it's about to create
   (`scfs-backend`, `scfs-frontend`, `scfs-db`). Review, then click **Apply**.
6. Wait for both services to finish building (a few minutes each, first time). Render shows
   each service's live URL once it's up — they'll be `https://scfs-backend.onrender.com` and
   `https://scfs-frontend.onrender.com` (matching the names in `render.yaml`; if you rename a
   service in the dashboard, also update the matching literal URL in `render.yaml`, since the
   two services find each other via those hardcoded values, not a live lookup).

Open the frontend URL, register an account (the database starts empty — none of your local
test accounts/plans carry over), and confirm a `/simulate` run and the Capacity Planning page
both work.

## Free-tier caveats (real, not hidden)

- **Cold starts**: both web services spin down after 15 minutes of no traffic. The next request
  after that takes ~30-60 seconds to wake back up. Normal — not a bug, just the free tier.
- **Postgres expires after 90 days**: Render deletes free Postgres databases 90 days after
  creation unless upgraded to a paid plan. There's no warning email guarantee — check the
  database's dashboard page for its creation date and plan ahead (upgrade, or accept losing the
  data and let the blueprint recreate an empty one).

## Shipping a future change

Render auto-redeploys both services on every push to `main` — no manual redeploy step. Just:

```bash
git push origin main
```

## Local dev is unaffected

Everything above is additive and env-gated:
- `src/db.py` only takes the Postgres-specific code path when `DATABASE_URL` is a `postgresql://`
  URL; unset (the local default) still means SQLite, identical to before this existed.
- `src/api.py`'s CORS origins default to `http://localhost:3000` when `CORS_ORIGINS` is unset.
- Local commands (`py -m uvicorn src.api:app --reload --port 8001`, `npm run dev`) are unchanged
  — see the main [CLAUDE.md](../CLAUDE.md) Commands section.
