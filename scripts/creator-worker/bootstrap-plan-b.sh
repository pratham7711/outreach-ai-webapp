#!/usr/bin/env bash
# Install Plan B's fetch service and its daily check on a fresh Linux VM
# (Azure or Google, US), idempotently. Run AS ROOT after copying this directory:
#
#   scp -r scripts/creator-worker root@vm:/opt/outreach-creator-worker/
#   ssh root@vm 'FETCH_TOKEN=... APP_URL=https://campaign.madeboring.com \
#       TRACKER_PLAN_B_HEALTH_TOKEN=... DOMAIN=b.example.com \
#       bash /opt/outreach-creator-worker/creator-worker/bootstrap-plan-b.sh'
#
# With DOMAIN set, Caddy terminates TLS for it and proxies to the service on
# 127.0.0.1:8787. Without it the service listens on 127.0.0.1 only and is not
# reachable from outside, which is the safe way to fail.
#
# The VM holds three things of ours: FETCH_TOKEN (what the app presents to
# fetch a page), the health token (what this box presents to report its daily
# check) and the app URL. No database credentials, no cron secret.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE=/etc/outreach-fetch.env
die() { echo "bootstrap-plan-b: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
[ -n "${FETCH_TOKEN:-}" ] && [ "${#FETCH_TOKEN}" -ge 24 ] || die "set FETCH_TOKEN (24+ characters; the same value goes in TRACKER_PLAN_B_TOKEN on Vercel)"
[ -n "${APP_URL:-}" ] || die "set APP_URL"
[ -n "${TRACKER_PLAN_B_HEALTH_TOKEN:-}" ] || die "set TRACKER_PLAN_B_HEALTH_TOKEN (the same value goes on Vercel)"

country="$(curl -fsS --max-time 8 https://ipinfo.io/country 2>/dev/null || true)"
echo "bootstrap-plan-b: egress ${country:-unknown}, $(curl -fsS --max-time 8 https://ipinfo.io/org 2>/dev/null || echo unknown)"
[ "$country" != "IN" ] || die "this box is in India; tiktok.com serves a placeholder here"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

umask 077
cat > "$ENV_FILE" <<ENV
FETCH_TOKEN=$FETCH_TOKEN
FETCH_HOST=127.0.0.1
FETCH_PORT=8787
APP_URL=$APP_URL
TRACKER_PLAN_B_HEALTH_TOKEN=$TRACKER_PLAN_B_HEALTH_TOKEN
ENV
chmod 600 "$ENV_FILE"

id creators >/dev/null 2>&1 || useradd --system --home /opt/outreach-creator-worker --shell /usr/sbin/nologin creators
chown -R creators:creators /opt/outreach-creator-worker
install -m 644 "$HERE/outreach-fetch.service" "$HERE/outreach-daily-check.service" "$HERE/outreach-daily-check.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now outreach-fetch.service

if [ -n "${DOMAIN:-}" ]; then
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  reverse_proxy 127.0.0.1:8787
}
CADDY
  systemctl reload caddy || systemctl restart caddy
fi

sleep 2
curl -fsS http://127.0.0.1:8787/healthz && echo
echo "bootstrap-plan-b: running the daily check once, without reporting"
# Sourced into this root shell and inherited, so no token is ever an argument.
( set -a; . "$ENV_FILE"; set +a; runuser -u creators -- node "$HERE/daily-check.mjs" --no-report ) || true
echo
echo "bootstrap-plan-b: if that read 12/12, schedule the daily report with:"
echo "  systemctl enable --now outreach-daily-check.timer"
