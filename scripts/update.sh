#!/bin/sh
# ============================================================
# Update and redeploy nd-bot-v2.
# Pulls latest code, installs deps, runs DB migrations, rebuilds the web SPA,
# then cycles the 'nd-bot-v2' screen session. Does NOT touch v1.
# ============================================================
set -e

SCREEN_NAME="nd-bot-v2"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$REPO_DIR"

echo "[update.sh] repo: ${REPO_DIR}"

echo "[update.sh] git pull"
git pull --ff-only

echo "[update.sh] bun install"
bun install

echo "[update.sh] db:migrate"
bun run db:migrate

echo "[update.sh] web:build"
bun run web:build

echo "[update.sh] restarting screen session '${SCREEN_NAME}'"
chmod +x scripts/restart.sh
sh "${REPO_DIR}/scripts/restart.sh"

echo "[update.sh] done. NGINX serves the new apps/web/dist immediately (static files)."
echo "[update.sh] tail logs: tail -f ${REPO_DIR}/logs/bot.log"
