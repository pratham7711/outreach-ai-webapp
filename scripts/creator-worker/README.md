# Creator worker — the TikTok Top Posts reader

The second thing this product cannot do from Vercel, and the reason this box
needs **real Chrome** where the sound worker's Playwright Chromium was enough.

## Why it exists

A creator's post grid arrives from `/api/post/item_list/`, signed by TikTok's
client script the same way music-detail is. But the grid is gated harder: the
script refuses to produce the tokens under headless SwiftShader Chromium. This
was measured, not assumed — from a Vercel Sandbox with clean iad1 egress, a
headless Chromium gets the full profile page (title, 489KB, rehydration blob)
and the grid still never renders; `item_list` never fires, scrolled or not.

Chrome's own binary carries the real GPU/canvas/WebGL surface the fingerprint
checks, so the reader launches `channel: "chrome"` (new headless — the real
binary, not the old stripped mode). If a particular box still reads nothing,
run headed under Xvfb (below) before concluding anything.

Profile **stats** never need any of this — they are server-rendered into the
page HTML and the app reads them itself through a Sandbox curl. This worker is
only for the grid.

## What it does and does not hold

Same contract as the sound worker: `APP_URL` and one token, never
`DATABASE_URL`. The app ranks the posts, keeps six, and refuses to overwrite
stored posts with an empty read — all in one place
(`app/api/trackers/creators/ingest`, through the same `rankTopPosts` the
in-process readers use). This box reads a list and hands it over.

## Requirements

- Any Linux VPS **outside India** (same block as the sound worker; the reader
  refuses to run from an IN egress). ~1.5 GB RAM; no GPU needed.
- Node 20+.
- **Google Chrome stable** — not chromium-browser, not Playwright's bundled
  Chromium. That distinction is the entire reason this worker exists.

## Install

```bash
# 1. Copy the two directories it needs. The worker imports the browser reader
#    from ../dev, so keep the layout.
ssh you@vps 'mkdir -p /opt/outreach-creator-worker'
scp -r scripts/creator-worker scripts/dev you@vps:/opt/outreach-creator-worker/

# 2. Node deps — one package.
ssh you@vps
cd /opt/outreach-creator-worker/creator-worker
npm install --omit=dev

# 3. Real Chrome. On Debian/Ubuntu:
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt-get update && sudo apt-get install -y google-chrome-stable

# 4. The token and the app it reports to.
sudo tee /etc/outreach-creator-worker.env >/dev/null <<'ENV'
APP_URL=https://campaign.madeboring.com
CREATOR_INGEST_TOKEN=<paste it here>
ENV
sudo chmod 600 /etc/outreach-creator-worker.env
```

`CREATOR_INGEST_TOKEN` is a Vercel environment variable you set on the project.
Absent that, the endpoint falls back to `SOUND_INGEST_TOKEN`, then
`CRON_SECRET` — the fallbacks work immediately, but set the dedicated token
before pointing anything real at it, for the same reason the sound worker's
README gives: a box running a browser against a hostile page should hold a
secret that can only write creator readings.

## Check it before scheduling it

```bash
cd /opt/outreach-creator-worker/creator-worker
APP_URL=... CREATOR_INGEST_TOKEN=... node read-top-posts.mjs --dry-run
```

`--dry-run` reads every grid for real and writes nothing. Expect `ok` lines
with post counts. If every creator reads stats but no posts (`skip ... page
gave no posts`), the fingerprint gate is refusing this box's new-headless
Chrome too — try headed under a virtual display before giving up:

```bash
sudo apt-get install -y xvfb
xvfb-run -a node read-top-posts.mjs --dry-run --headed
```

If headed-under-Xvfb reads grids where new-headless did not, change `ExecStart`
in the service to `/usr/bin/xvfb-run -a /usr/bin/node read-top-posts.mjs --headed`.
If NEITHER reads a grid, this VPS's IP range may be the problem — that result
is worth knowing before renting a second box: try one different provider/region
before concluding the approach is dead.

## Schedule

```bash
sudo useradd --system --home /opt/outreach-creator-worker --shell /usr/sbin/nologin creators
sudo chown -R creators:creators /opt/outreach-creator-worker
sudo cp outreach-creators.service outreach-creators.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now outreach-creators.timer

systemctl list-timers outreach-creators.timer   # when it next fires
journalctl -u outreach-creators.service -n 50   # what the last run said
```

Daily, jittered. The app treats top posts under 20 hours old as fresh
(`TOP_POSTS_MAX_AGE_MS`), so one read a day keeps every sweep inside the
window, and one grid load per creator per day does not look like a scraper.

## When it breaks, it says so — and only then

Exit codes follow the sound worker's rule: only a creator **whose grid was
read within the last 30 days** and has stopped counts as a failure. A creator
whose grid never read (new row, renamed handle, private account) is a `skip`
and a warning — a row to look at, not an outage to chase. The `LOST` lines in
the journal name the creators and the page evidence (`title=... len=...`), so
a WAF shell, a challenge page and a dead handle all read differently.

## How the data flows

```
timer → read-top-posts.mjs
  GET  /api/trackers/creators/ingest      → tracked TikTok creators
  real Chrome → tiktok.com/@handle        → item_list JSON (+ stats blob)
  POST /api/trackers/creators/ingest      → { creatorId, posts[] }
                                             app ranks, keeps 6, stamps topPostsAt
UI: Trackers → creator modal → Top Posts grid (reads Creator.topPosts)
```

The Vercel-side sweep keeps trying its own ladder (direct fetch → sandbox →
browser) and still refuses to overwrite stored posts with an empty read, so
worker-fed posts survive serverless failures, and the two paths never fight —
last successful read wins, whichever side made it.
