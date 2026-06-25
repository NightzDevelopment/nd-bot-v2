#!/bin/sh
# ============================================================
# nd-bot-v2 run loop.
# Runs the bot under Bun and restarts it if it crashes. Intended to run inside
# a detached screen session named nd-bot-v2 (see start-screen.sh).
#
# Logs go to logs/bot.log (rotated by size on each launch is NOT done here;
# the file just appends). Watch live with:
#   screen -r nd-bot-v2
# or:
#   tail -f logs/bot.log
# ============================================================
set -e

# Resolve the repo root from this script's location, regardless of cwd.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$REPO_DIR"

mkdir -p logs

LOG_FILE="logs/bot.log"

# Load .env so bun sees the runtime config (bun also auto-loads .env, this is a
# safety net for vars some tooling reads from the environment directly).
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
fi

echo "[run.sh] starting nd-bot-v2 run loop at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG_FILE"

# Crash-restart loop. set -e is intentionally relaxed inside the loop so a bot
# exit does not kill the supervisor; we catch the code and back off.
set +e
while true; do
    echo "[run.sh] launching bot at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG_FILE"
    bun run --cwd apps/bot start >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
    echo "[run.sh] bot exited with code ${EXIT_CODE} at $(date -u +%Y-%m-%dT%H:%M:%SZ); restarting in 3s" >> "$LOG_FILE"
    sleep 3
done
