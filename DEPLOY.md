# Deploying nd-bot-v2 to botv2.nightz.dev

This guide deploys v2 on the existing VPS at a NEW subdomain, **botv2.nightz.dev**,
running ALONGSIDE v1 (bot.nightz.dev). It mirrors the proven v1 approach:
Bun + a `screen` session + an NGINX reverse proxy + certbot HTTPS.

The v1 deployment is not touched at any step. v2 gets its own repo dir, its own
NGINX site file, its own screen session (`nd-bot-v2`), and its own certificate.

## Architecture

- NGINX serves the built SPA from `apps/web/dist` as static files.
- NGINX reverse-proxies `/api/` and `/ws` to the bot's HTTP/WS server on
  `127.0.0.1:4000` (`API_HOST` / `API_PORT` in `.env`).
- The bot runs under Bun inside a detached `screen` session named `nd-bot-v2`,
  supervised by a crash-restart loop (`scripts/run.sh`).

```
browser ──https──> NGINX (botv2.nightz.dev)
                     ├── /            -> apps/web/dist  (static SPA)
                     ├── /api/        -> 127.0.0.1:4000 (bot REST)
                     └── /ws          -> 127.0.0.1:4000 (bot WebSocket)
```

## Important: the bot token is shared with v1

v2 reuses v1's `DISCORD_BOT_TOKEN`. A single Discord bot token can only be used
by ONE gateway connection at a time. If both v1 and v2 run on the same token
simultaneously they will fight over the gateway and disconnect each other.

Choose one of:
- Stop v1 before starting v2 (cutover), or
- Create a separate Discord application/bot and use a distinct token for v2.

The dashboard side (HTTP/WS API, NGINX, the subdomain) is fully independent and
can run alongside v1 regardless. Only the Discord gateway login conflicts.

---

## Prerequisites on the VPS (shared with v1)

These are already installed for v1. Confirm they exist:

- bun (>= 1.1): `bun --version`
- screen: `screen --version`
- nginx: `nginx -v`
- certbot + nginx plugin: `certbot --version`
- git

DNS: create an A/AAAA record for `botv2.nightz.dev` pointing at the VPS IP, same
as `bot.nightz.dev`. Confirm it resolves before running certbot.

---

## 1. Clone the repo

Use a separate directory from v1. The NGINX file and scripts assume
`/opt/nd-bot-v2`; if you use a different path, update the `root` in
`deploy/nginx/botv2.nightz.dev.conf` and `REPO_DIR` in `scripts/setup-vps.sh`.

```sh
sudo mkdir -p /opt/nd-bot-v2
sudo chown "$USER":"$USER" /opt/nd-bot-v2
git clone <repo-url> /opt/nd-bot-v2
cd /opt/nd-bot-v2
```

## 2. Install dependencies

```sh
bun install
```

## 3. Configure .env

```sh
cp .env.example .env
```

Edit `.env` and set the v2 values:

| Key | Value |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Reuse v1's token (see the token-sharing note above) or a new bot's token. |
| `DISCORD_CLIENT_ID` | Discord application client ID. |
| `DISCORD_GUILD_ID` | Target guild ID. |
| `DASHBOARD_PUBLIC_URL` | `https://botv2.nightz.dev` |
| `DASHBOARD_JWT_SECRET` | Generate: `openssl rand -hex 32` |
| `DISCORD_OAUTH_CLIENT_ID` | Discord OAuth client ID (the app's client ID). |
| `DISCORD_OAUTH_CLIENT_SECRET` | Discord OAuth client secret. |
| `DASHBOARD_ADMIN_USER_IDS` | Comma-separated Discord user IDs allowed into the dashboard. |
| `DASHBOARD_ADMIN_ROLE_IDS` | Comma-separated Discord role IDs allowed into the dashboard. |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | AI provider keys. |
| `API_HOST` / `API_PORT` | Leave at `127.0.0.1` / `4000` to match the NGINX config. |

Generate the JWT secret:

```sh
openssl rand -hex 32
```

### Discord OAuth redirect

In the Discord Developer Portal, open the application -> OAuth2 -> Redirects and
ADD (do not replace v1's) this exact callback URL:

```
https://botv2.nightz.dev/api/auth/callback
```

Both v1 and v2 callbacks can coexist on the same application's redirect list.

## 4. Migrate the database and build the SPA

```sh
bun run db:migrate
bun run web:build
```

`db:migrate` creates the SQLite file at `DATABASE_PATH`. `web:build` outputs the
SPA to `apps/web/dist`, which NGINX serves.

## 5. Install the NGINX site

```sh
sudo cp deploy/nginx/botv2.nightz.dev.conf /etc/nginx/sites-available/botv2.nightz.dev
sudo ln -s /etc/nginx/sites-available/botv2.nightz.dev /etc/nginx/sites-enabled/botv2.nightz.dev
```

The config references `$connection_upgrade` for WebSocket upgrades. This must be
defined exactly once at the `http{}` level. v1 likely already defines it. If a
plain `sudo nginx -t` complains that `$connection_upgrade` is undefined, add the
map once in a shared conf file:

```sh
sudo tee /etc/nginx/conf.d/websocket_upgrade.conf >/dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF
```

If v1 ALREADY defines this map, do not add a second copy or NGINX will fail with
a duplicate-map error. Then:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

At this point `http://botv2.nightz.dev` serves the SPA and proxies the API.

## 6. Enable HTTPS with certbot

With DNS resolving to the VPS:

```sh
sudo certbot --nginx -d botv2.nightz.dev
```

certbot obtains the cert, rewrites the port-80 block to redirect to 443, and
injects the SSL server block. Auto-renewal is handled by the existing certbot
systemd timer (shared with v1). Verify renewal config:

```sh
sudo certbot renew --dry-run
```

## 7. Start the bot

```sh
chmod +x scripts/*.sh
sh scripts/start-screen.sh
```

This launches `scripts/run.sh` (the crash-restart loop) in a detached screen
session named `nd-bot-v2`, logging to `logs/bot.log`.

Verify:

```sh
screen -list                 # should show a session named nd-bot-v2
tail -f logs/bot.log         # watch startup
screen -r nd-bot-v2          # attach (Ctrl-A then D to detach)
```

Then open `https://botv2.nightz.dev`, confirm the dashboard loads, log in via
Discord OAuth, and confirm `/api` and the WebSocket connect.

---

## One-shot setup helper

`scripts/setup-vps.sh` walks through steps 1, 2, 4, 5, and 7 with guards and
prints the certbot command. Edit `REPO_DIR` / `REPO_URL` at the top first. It
pauses after creating `.env` so you can fill it in, then re-run it.

---

## Day-to-day operations

| Action | Command |
| --- | --- |
| Deploy latest code | `sh scripts/update.sh` |
| Restart the bot | `sh scripts/restart.sh` |
| Start (if stopped) | `sh scripts/start-screen.sh` |
| View logs | `tail -f logs/bot.log` |
| Attach to session | `screen -r nd-bot-v2` (detach: Ctrl-A then D) |
| Stop the bot | `screen -S nd-bot-v2 -X quit` |

`scripts/update.sh` runs: `git pull` -> `bun install` -> `bun run db:migrate` ->
`bun run web:build` -> restart the `nd-bot-v2` screen. NGINX picks up the rebuilt
`apps/web/dist` immediately since it serves those files directly.

## Rollback

```sh
cd /opt/nd-bot-v2
git log --oneline -n 10
git checkout <previous-good-commit>
bun install
bun run web:build
sh scripts/restart.sh
```

If a migration is involved, restore the SQLite file from backup before checking
out the older code, since older code may not understand a newer schema.

## Notes on running alongside v1

- v1 is at `bot.nightz.dev`; v2 is at `botv2.nightz.dev`. Separate NGINX site
  files, separate certs, separate repo dirs, separate screen sessions.
- v1 and v2 must NOT both bind the same `API_PORT`. v2 defaults to `4000`. If v1
  also uses `4000`, change v2's `API_PORT` in `.env` and update `proxy_pass` in
  `deploy/nginx/botv2.nightz.dev.conf` to match.
- The only true conflict is the shared Discord bot token (see the top of this
  guide). Everything else is isolated.
