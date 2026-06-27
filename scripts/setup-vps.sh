#!/bin/sh
# ============================================================
# nd-bot-v2 one-time VPS setup.
#
# Run this ONCE on a fresh Ubuntu VPS. It is a guarded walkthrough: it installs
# prerequisites (step 0), clones (if needed), installs deps, prepares .env, runs
# migrations, builds the web SPA, installs the NGINX site, and prints the
# certbot command. Re-running is safe; existing steps are skipped or are
# idempotent.
#
# Step 0 installs these automatically if missing (skip this list, it is FYI):
#   - bun (>= 1.1)         curl -fsSL https://bun.sh/install | bash
#   - screen               sudo apt-get install -y screen
#   - nginx                sudo apt-get install -y nginx
#   - certbot + nginx plugin   sudo apt-get install -y certbot python3-certbot-nginx
#   - git
#
# Edit REPO_DIR / REPO_URL below to match your setup, then:
#   sh scripts/setup-vps.sh
# ============================================================
set -e

REPO_DIR="/opt/nd-bot-v2"
REPO_URL="https://github.com/NightzDevelopment/nd-bot-v2.git"
SCREEN_NAME="nd-bot-v2"
SITE="botv2.nightz.dev"

echo "[setup-vps.sh] target repo dir: ${REPO_DIR}"

# 0. Install prerequisites on a fresh Ubuntu VPS (idempotent; skipped if present).
# unzip is required by the bun installer, so it must be present before bun.
if ! command -v git >/dev/null 2>&1 || ! command -v nginx >/dev/null 2>&1 || ! command -v screen >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
    echo "[setup-vps.sh] installing system packages (git, curl, unzip, screen, nginx, certbot)"
    sudo apt-get update
    sudo apt-get install -y git curl unzip screen nginx certbot python3-certbot-nginx
fi
if ! command -v bun >/dev/null 2>&1; then
    echo "[setup-vps.sh] installing bun"
    curl -fsSL https://bun.sh/install | bash
fi
# Make bun available to the rest of this script even right after first install.
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

# 1. Clone (if not already present). If you already cloned manually, skip.
if [ ! -d "${REPO_DIR}/.git" ]; then
    echo "[setup-vps.sh] cloning ${REPO_URL} -> ${REPO_DIR}"
    git clone "${REPO_URL}" "${REPO_DIR}"
else
    echo "[setup-vps.sh] repo already present, pulling latest"
    git -C "${REPO_DIR}" pull --ff-only
fi

cd "${REPO_DIR}"

# 2. Install dependencies.
echo "[setup-vps.sh] bun install"
bun install

# 3. Prepare .env. Copy the example, then EDIT it before continuing.
if [ ! -f .env ]; then
    echo "[setup-vps.sh] creating .env from .env.example"
    cp .env.example .env
    echo ""
    echo "  ACTION REQUIRED: edit ${REPO_DIR}/.env and set the v2 keys:"
    echo "    DISCORD_BOT_TOKEN          (reuse v1 token; only ONE process may use it at a time)"
    echo "    DASHBOARD_PUBLIC_URL       https://${SITE}"
    echo "    DASHBOARD_JWT_SECRET       openssl rand -hex 32"
    echo "    DISCORD_OAUTH_CLIENT_ID / DISCORD_OAUTH_CLIENT_SECRET"
    echo "    DASHBOARD_ADMIN_USER_IDS / DASHBOARD_ADMIN_ROLE_IDS"
    echo "    GEMINI_API_KEY / ANTHROPIC_API_KEY"
    echo ""
    echo "  Re-run this script after editing .env, or continue the steps manually."
    exit 0
else
    echo "[setup-vps.sh] .env already exists, leaving it untouched"
fi

# 4. Database migrations (creates the SQLite file at DATABASE_PATH).
echo "[setup-vps.sh] db:migrate"
bun run db:migrate

# 5. Build the web SPA -> apps/web/dist (served by NGINX).
echo "[setup-vps.sh] web:build"
bun run web:build

# 6. Install the NGINX site (HTTP first; HTTPS via certbot afterwards).
echo "[setup-vps.sh] installing NGINX site for ${SITE}"
sudo cp "deploy/nginx/${SITE}.conf" "/etc/nginx/sites-available/${SITE}"
if [ ! -e "/etc/nginx/sites-enabled/${SITE}" ]; then
    sudo ln -s "/etc/nginx/sites-available/${SITE}" "/etc/nginx/sites-enabled/${SITE}"
fi

# The WebSocket upgrade map must exist exactly once at http{} level. If v1 does
# not already define $connection_upgrade, create it here. If v1 DOES define it,
# this overwrite keeps a single definition; do not add a second one per-site.
echo "[setup-vps.sh] ensuring $connection_upgrade map exists"
sudo sh -c 'cat > /etc/nginx/conf.d/websocket_upgrade.conf <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ""      close;
}
EOF'

echo "[setup-vps.sh] nginx -t"
sudo nginx -t
sudo systemctl reload nginx

# 7. Start the bot in a detached screen session.
echo "[setup-vps.sh] starting screen session '${SCREEN_NAME}'"
chmod +x scripts/run.sh scripts/start-screen.sh scripts/restart.sh scripts/update.sh
sh "${REPO_DIR}/scripts/start-screen.sh"

# 8. HTTPS via certbot (run once DNS for the subdomain resolves to this VPS).
echo ""
echo "[setup-vps.sh] base setup complete. Final step, enable HTTPS:"
echo "    sudo certbot --nginx -d ${SITE}"
echo ""
echo "Then visit https://${SITE} and confirm the dashboard loads and /api works."
