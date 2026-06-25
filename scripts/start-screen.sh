#!/bin/sh
# ============================================================
# Launch the nd-bot-v2 run loop inside a detached screen session.
# Safe to call when nothing is running. If a session already exists, this exits
# without starting a second one (use restart.sh to cycle it).
# ============================================================
set -e

SCREEN_NAME="nd-bot-v2"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$REPO_DIR"

if screen -list | grep -q "\.${SCREEN_NAME}[[:space:]]"; then
    echo "[start-screen.sh] screen session '${SCREEN_NAME}' already running. Use restart.sh to cycle it."
    exit 0
fi

mkdir -p logs
chmod +x scripts/run.sh

echo "[start-screen.sh] starting detached screen session '${SCREEN_NAME}'"
screen -dmS "${SCREEN_NAME}" sh "${REPO_DIR}/scripts/run.sh"

echo "[start-screen.sh] done. Attach with: screen -r ${SCREEN_NAME}"
echo "[start-screen.sh] logs: tail -f ${REPO_DIR}/logs/bot.log"
