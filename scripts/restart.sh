#!/bin/sh
# ============================================================
# Restart the nd-bot-v2 screen session.
# Kills the existing 'nd-bot-v2' screen (if any) and relaunches run.sh in a
# fresh detached screen. Does NOT touch v1 (bot.nightz.dev).
# ============================================================
set -e

SCREEN_NAME="nd-bot-v2"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$REPO_DIR"

if screen -list | grep -q "\.${SCREEN_NAME}[[:space:]]"; then
    echo "[restart.sh] stopping existing screen session '${SCREEN_NAME}'"
    screen -S "${SCREEN_NAME}" -X quit || true
    # Give the loop a moment to release the bot process.
    sleep 2
fi

mkdir -p logs
chmod +x scripts/run.sh

echo "[restart.sh] launching detached screen session '${SCREEN_NAME}'"
screen -dmS "${SCREEN_NAME}" sh "${REPO_DIR}/scripts/run.sh"

echo "[restart.sh] done. Attach with: screen -r ${SCREEN_NAME}"
