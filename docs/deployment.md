# Deployment (Render, free tier)

The repo includes `render.yaml` at the root — a Render "Blueprint" that provisions all three
pieces this app needs (FastAPI backend, Next.js frontend, Postgres database) from one file, with
the env vars that connect them already wired up. No Docker, no manual per-service config, no
accounts or login to set up.

## One-time setup

1. Push this repo to GitHub (`git push origin main` — already configured).
2. Go to [render.com](https://render.com) and sign in with your GitHub account.
3. Click **New +** → **Blueprint**.
4. Select the `najeeb101/Single-Cohort-Flow-Simulator` repo.
5. Render reads `render.yaml` and shows the three services it's about to create
   (`scfs-backend`, `scfs-frontend`, `scfs-db`). Review, then click **Apply**.
6. Wait for both services to finish building (a few minutes each on first deploy).

Once both services are green, open `https://scfs-frontend.onrender.com`. The app loads
directly — no login or account creation needed. Run a simulation and confirm the Dashboard
and Bottlenecks pages work.

## Free-tier caveats

- **Cold starts**: both web services spin down after 15 minutes of no traffic. The next
  request after that takes 30–60 seconds to wake back up. Normal for a demo/research tool —
  not a bug.
- **Postgres expires after 90 days**: Render deletes free Postgres databases 90 days after
  creation. Check the database dashboard for its creation date and either upgrade to a paid
  plan (~$7/mo) or accept losing the stored config/plans and letting the blueprint recreate
  an empty database.

## Shipping a change

Render auto-redeploys both services on every push to `main`:

```bash
git push origin main
```

No manual redeploy step needed.

## Local dev is unaffected

- `src/db.py` uses Postgres only when `DATABASE_URL` is a `postgresql://` URL; unset locally
  means SQLite, identical to before.
- `src/api.py` CORS origins default to `http://localhost:3000` when `CORS_ORIGINS` is unset.
- Local commands (`py -m uvicorn src.api:app --port 8001`, `cd web && npm run dev`) are
  unchanged — see [CLAUDE.md](../CLAUDE.md).
