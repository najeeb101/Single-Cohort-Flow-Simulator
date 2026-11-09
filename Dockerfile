# Public read-only demo image (see docs/deploy.md): the FastAPI backend and the Next.js site in one
# container, served on one port. Built for Hugging Face Spaces (Docker SDK, port 7860) but runs
# anywhere:  docker build -t cs-intake-planner . && docker run -p 7860:7860 cs-intake-planner

# ---- 1. Build the website --------------------------------------------------------------------
FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2. Runtime: Python backend + the built site ---------------------------------------------
FROM python:3.12-slim
# Spaces runs containers as user 1000 and only /home/user is writable.
RUN useradd -m -u 1000 user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1
WORKDIR /home/user/app

# Node is only needed to serve the already-built site, so copy the binary instead of installing npm.
COPY --from=node:20-slim /usr/local/bin/node /usr/local/bin/node

COPY --chown=user requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user src ./src
COPY --chown=user data ./data
COPY --chown=user run.py ./
COPY --chown=user scripts/start_demo.sh ./scripts/start_demo.sh
COPY --chown=user --from=web /web ./web
RUN chmod +x scripts/start_demo.sh && chown user:user data

USER user
ENV DEMO_MODE=1 PORT=7860
EXPOSE 7860
CMD ["bash", "scripts/start_demo.sh"]
