# Deploying the public demo (free)

The department runs the planner locally (`start.bat`). For recruiters and anyone else who should be
able to try it without installing anything, the same code runs as a **read-only demo** from one
Docker image. Nothing about the local setup changes; demo behaviour is switched on by
`DEMO_MODE=1`, which only the Docker image sets.

**Status (2026-11): hosting options.** Hugging Face Docker Spaces now need a PRO plan (creating one
returns HTTP 402), Google Cloud Run needs a billing card, and a student Azure account cannot create
resource groups. The zero-cost route that works with no card is the
[Cloudflare quick tunnel](#free-no-card-run-it-on-your-pc-behind-a-cloudflare-tunnel) below.

## What the demo does differently

| | Local (department PC) | Public demo (`DEMO_MODE=1`) |
|---|---|---|
| Users | one shared local user | one private session per visitor (`demo_sid` cookie) |
| Saved plan, data, past intakes | editable | read-only (403 with an explanation) |
| First screen | first-run data setup | skipped; opens on a precomputed result |
| "Run analysis" | full size (~570 simulations) | lite: 20-120 intakes in steps of 20, 12 seeds, no robustness pass |
| Walkthrough, Advisor Test, Bottlenecks | yes | yes, on the visitor's own working copy |
| Advisor chat | local Ollama | off unless `LLM_*` secrets are set (see below) |
| Heavy requests | unlimited | rate limited per client |

Code: `src/api/demo.py` (guard, sessions, lite settings), `src/api/auth.py` (per-visitor user),
`scripts/build_demo_showcase.py` (the precomputed result), `tests/test_demo_mode.py`.

## Free, no card: run it on your PC behind a Cloudflare tunnel

```bash
docker build -t cs-intake-planner .
docker run -d --name cs-demo --restart unless-stopped -p 127.0.0.1:7860:7860 cs-intake-planner
cloudflared tunnel --url http://127.0.0.1:7860 --protocol http2
```

`cloudflared` prints a `https://<random>.trycloudflare.com` link. Use `--protocol http2` if the
default QUIC connection times out. The demo is up only while the PC, the container and the tunnel
run, and the URL changes on every tunnel restart, so share it for a live demo, not as a permanent
CV link. Analyses run at full speed on the PC's cores.

## Hugging Face Space (needs a PRO plan)


1. On a Hugging Face account with PRO, create a **New Space**: SDK **Docker**, template **Blank**,
   hardware **CPU basic**, visibility **Public**.
2. Create an access token with **write** access (Settings, Access Tokens).
3. Deploy from the repo root:

   ```bash
   scripts/deploy_hf_space.sh <your-username>/<space-name>
   ```

   Git asks for credentials: username is your Hugging Face username, password is the token.
   The Space then builds the image (about 5 minutes) and starts it.
4. Share the direct link `https://<your-username>-<space-name>.hf.space`, not the
   huggingface.co page. The direct link keeps each visitor's private session reliable (browsers can
   block the cookie inside the huggingface.co frame).

To update the demo, commit and run the script again.

## Keeping the precomputed result fresh

`data/demo_showcase.json` is the full-size analysis and seat plan that new visitors see first.
Rebuild and commit it whenever the shipped data (`data/curriculum.json`,
`data/simulation_config.json`) or the planner's logic changes:

```bash
py scripts/build_demo_showcase.py      # a minute or two on a multi-core PC
```

`tests/test_demo_mode.py::test_committed_showcase_matches_the_shipped_default_plan` fails if it is
out of date.

## Optional: turn on the Advisor chat

Ollama can't run on a free host, so the chat is off by default and the rules-based Advisor page
still works. To enable it, add Space secrets (Settings, Variables and secrets) for any
OpenAI-compatible free tier, for example Groq: `LLM_BASE_URL=https://api.groq.com/openai/v1`,
`LLM_MODEL=llama-3.3-70b-versatile`, `LLM_API_KEY=<your key>`. Only aggregate plan and result
numbers are sent, never student records. Free tiers have their own rate limits.

## Behaviour to expect on a Space

- The Space **sleeps after 48 hours without visitors** and wakes in about a minute on the next
  visit (the site retries while it starts).
- Storage is **ephemeral**: a restart resets everyone's sessions and the database reseeds from
  `data/*.json`. That is fine for a demo.
- Only **one analysis runs at a time**; a second visitor who clicks "Run analysis" meanwhile is told
  to wait.
- Everything shown rests on estimated inputs and is labelled illustrative.

## Run the image locally first

```bash
docker build -t cs-intake-planner .
docker run --rm -p 7860:7860 cs-intake-planner     # then open http://localhost:7860
```

## Other free hosts

The same image works anywhere that runs a container and routes one port (set `PORT` if the host
requires it): Google Cloud Run (free tier, scales to zero, needs a card), Koyeb, or Render's free
web service (0.1 vCPU and 512 MB: browsing works, but "Run analysis" would take tens of minutes).
