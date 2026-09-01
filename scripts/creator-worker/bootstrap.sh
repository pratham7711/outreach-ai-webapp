#!/usr/bin/env bash
# Install the creator worker on a fresh Linux box, from nothing to a scheduled
# timer, idempotently. Run it AS ROOT on the VPS after copying this directory
# and ../dev alongside it:
#
#   scp -r scripts/creator-worker scripts/dev root@vps:/opt/outreach-creator-worker/
#   ssh root@vps 'APP_URL=https://campaign.madeboring.com CREATOR_INGEST_TOKEN=... \
#       bash /opt/outreach-creator-worker/creator-worker/bootstrap.sh'
#
# It stops before scheduling anything. The dry run is the experiment -- whether
# TikTok's grid answers real Chrome from THIS box's egress -- and a timer that
# fires against a refused IP is just a machine talking to itself. Read the dry
# run, then enable the timer with the line it prints.
set -euo pipefail

ROOT=/opt/outreach-creator-worker
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE=/etc/outreach-creator-worker.env

die() { echo "bootstrap: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
[ -d "$HERE/../dev" ] || die "scripts/dev must sit beside this directory (the reader is imported from ../dev)"
[ -n "${APP_URL:-}" ] || die "set APP_URL"
[ -n "${CREATOR_INGEST_TOKEN:-}" ] || die "set CREATOR_INGEST_TOKEN (it is set on the Vercel project; ask for it)"

# Refuse early where the answer is already known, rather than after installing
# a browser: from an Indian IP tiktok.com never serves a usable page.
country="$(curl -fsS --max-time 8 https://ipinfo.io/json 2>/dev/null | sed -n 's/.*"country": *"\([A-Z]*\)".*/\1/p' || true)"
echo "bootstrap: egress country ${country:-unknown}"
[ "$country" != "IN" ] || die "this box is in India; tiktok.com serves a placeholder here. Use another region."

echo "bootstrap: installing node, xvfb and real Chrome"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg xvfb fonts-liberation >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

# Google Chrome stable, NOT chromium and NOT Playwright's bundled build. That
# distinction is the entire reason this worker exists: TikTok's signing script
# refuses headless builds, and the bundled Chromium is refused even headed.
if ! command -v google-chrome >/dev/null; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
  apt-get update -qq
  apt-get install -y -qq google-chrome-stable >/dev/null
fi
echo "bootstrap: $(google-chrome --version), $(node -v)"

echo "bootstrap: installing worker dependencies"
cd "$HERE"
npm install --omit=dev --silent

umask 077
cat > "$ENV_FILE" <<ENV
APP_URL=$APP_URL
CREATOR_INGEST_TOKEN=$CREATOR_INGEST_TOKEN
ENV
chmod 600 "$ENV_FILE"

id creators >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin creators
chown -R creators:creators "$ROOT"
install -m 644 "$HERE/outreach-creators.service" "$HERE/outreach-creators.timer" /etc/systemd/system/
systemctl daemon-reload

# The unit's OnFailure points at status-email@.service, which no distro ships.
# Missing, systemd logs one line and moves on -- so a failing worker would fail
# silently, which is the exact thing the alert exists to prevent. Say so out
# loud rather than letting it look configured.
if ! systemctl cat 'status-email@.service' >/dev/null 2>&1; then
  echo "bootstrap: WARNING no status-email@.service on this box, so OnFailure alerts go nowhere."
  echo "bootstrap:   Either write that template unit or watch: journalctl -u outreach-creators.service"
fi

# The app link, with no browser and no TikTok in the way. If this fails, the
# token or the network is wrong and Chrome is irrelevant.
echo "bootstrap: checking the app link"
set -a; . "$ENV_FILE"; set +a
node "$HERE/read-top-posts.mjs" --self-test || die "the app link failed; fix that before reading any grid"

cat <<MSG

bootstrap: installed. Now run THE EXPERIMENT -- it writes nothing:

  cd $HERE && set -a && . $ENV_FILE && set +a && xvfb-run -a node read-top-posts.mjs --dry-run

  'ok  @handle  posts=N'   the egress hypothesis held. Schedule it:
                             systemctl enable --now outreach-creators.timer
  'skip ... no grid'       this IP range is refused too. Try one other
                           provider, then stop paying for boxes and buy the
                           scraper -- see README.md.
MSG
