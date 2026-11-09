#!/usr/bin/env bash
# Publish the current commit to a Hugging Face Space (Docker SDK). See docs/deploy.md.
#
#   scripts/deploy_hf_space.sh <hf-username>/<space-name>
#
# A Space is its own git repo whose README.md must start with Space settings (deploy/hf-space/README.md),
# which would clutter the GitHub README, so this pushes a one-commit snapshot of HEAD with that README
# swapped in. The Space history is only a deploy artifact; GitHub stays the source of truth.
# Needs `git` and a Hugging Face access token with write access (git will prompt for it as the password).
set -euo pipefail

SPACE="${1:?usage: scripts/deploy_hf_space.sh <hf-username>/<space-name>}"
ROOT="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "Note: uncommitted changes are NOT deployed (only HEAD is)." >&2
fi

git -C "$ROOT" archive HEAD | tar -x -C "$WORK"
cp "$ROOT/deploy/hf-space/README.md" "$WORK/README.md"

cd "$WORK"
git init -q -b main
git add -A
git -c user.name="deploy" -c user.email="deploy@local" commit -q -m "Deploy $(git -C "$ROOT" rev-parse --short HEAD)"
git push --force "https://huggingface.co/spaces/${SPACE}" main
echo "Pushed. The Space builds for a few minutes: https://huggingface.co/spaces/${SPACE}"
