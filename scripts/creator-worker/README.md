# Creator worker — the TikTok Top Posts reader

The second thing this product cannot do from Vercel — and, as of 2026-09-01,
**the last untested hypothesis** for reading a creator's post grid.

## Why it exists

A creator's post grid arrives from `/api/post/item_list/`, signed by TikTok's
client script the same way `/api/music/detail/` is. From Vercel egress it
answers **200 with a zero-byte body** in every browser configuration measured
against the same handle:

| Configuration (Vercel egress) | `/api/post/item_list/` |
|---|---|
| headless `@sparticuz/chromium`, function | ✗ never fires |
| headless `@sparticuz/chromium`, Sandbox | ✗ never fires |
| new-headless `google-chrome`, Sandbox | ✗ 200, 0 bytes |
| headed `google-chrome` + Xvfb, Sandbox | ✗ 200, 0 bytes |
| real Chrome, laptop (India egress) | ✗ placeholder page |

**A trap worth naming.** The same page visit makes
`/api/repost/item_list/` answer with 30 real items — the creator's *reposts*,
authored by other people. Matching on the substring `item_list` picks those up
and silently fills Top Posts with someone else's videos. It cost a wrong
conclusion here; match the exact path.

## So why is a VPS still worth trying?

Because egress reputation is the one variable Vercel cannot change. The sound
worker's `/api/music/detail/` is signed the same way, fails the same way from
Vercel, and **works from a rented box** (measured: Netherlands egress, 9.7s, a
real count). Vercel Sandbox runs on hyperscaler IP ranges TikTok has every
reason to distrust; an ordinary VPS is a different reputation class.

That is a hypothesis with precedent, not a certainty. The dry-run below is what
settles it, and it costs one hour of a $5/mo box. If it fails there too, the
self-hosted route is exhausted and ScrapeCreators (~$3–6/mo) is the answer.

Run it **headed under Xvfb** regardless — headless is refused outright, so a
display is necessary even if it is not sufficient.

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
APP_URL=... CREATOR_INGEST_TOKEN=... xvfb-run -a node read-top-posts.mjs --dry-run --headed
```

`--dry-run` reads every grid for real and writes nothing.

**This run is the experiment.** `ok` lines with post counts mean the egress
hypothesis held and the tracker is unblocked — schedule it. `skip ... page gave
no posts` on every creator means this IP range is refused too; try one other
provider before concluding, then stop paying for boxes and buy the scraper.

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

The Vercel-side sweep keeps trying its own ladder (direct fetch → sandbox curl
→ in-function browser) for STATS, and refuses to overwrite stored posts with an
empty read — so worker-fed posts survive serverless failures and the two paths
never fight. Last successful read wins, whichever side made it.
