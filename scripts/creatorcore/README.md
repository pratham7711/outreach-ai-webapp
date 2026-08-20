# CreatorCore → our DB

Pulls **all** of your CreatorCore data (a Bubble.io app) into our database.

## Why this is a script you run (not something the agent ran)

CreatorCore serves data only to an authenticated browser session, and the
volume is large (~506 campaigns, ~18,680 posts, ~21 MB). The agent's sandbox
blocked every bulk-to-disk channel, so extraction runs on your machine with your
login. Nothing here stores credentials in the repo — the login lives in a
gitignored Playwright profile.

## 1. Extract

```bash
cd webapp
npx playwright install chromium        # one-time: headed browser for the login step
node scripts/creatorcore/cc-extract.mjs
```

A Chromium window opens. **Log in to CreatorCore once.** The script waits for an
authenticated session, then pages every readable type to
`scripts/creatorcore/out/<type>.jsonl`, retrying the backend's intermittent
`Database query timeout` with backoff. It checkpoints after every page — if it
dies, just run it again and it resumes.

Readable types (the Data API exposes 4; the rest are attempted and skipped if
refused): `campaign`, `post`, `statistic-post`, `campaign-postrefreshqueue`.

## 2. Create the mirror tables (one-time per DB)

The importer writes into 5 CreatorCore mirror tables (`CcCampaign`, `CcPost`,
`CcStatisticPost`, `CcRefreshQueue`, `CcRecord`). Push the schema first — additive
only, no data loss:

```bash
npx prisma db push                                   # dev
DATABASE_URL='postgres://…prod…' npx prisma db push  # prod
```

## 3. Import

Dev first:

```bash
node --env-file=.env scripts/creatorcore/cc-import.mjs
```

Then prod (point DATABASE_URL at the prod branch):

```bash
DATABASE_URL='postgres://…prod…' node scripts/creatorcore/cc-import.mjs
```

- **Target org**: set `CC_IMPORT_ORG_ID=<id>`, else it uses `admin@demo.com`'s
  org, else the first Organization. It prints which org it chose before writing.
- **Idempotent**: re-running updates in place (tracked in `out/_idmap.json`).
- **Nothing lost**: the full raw CreatorCore record is stored in
  `platformMetrics.__cc` (posts) and `typeConfig.__cc` (campaigns), regardless of
  how the convenience columns map.

## 4. Verify (optional)

```bash
node scripts/creatorcore/cc-import.test.mjs   # checks the mapping + mirror helpers
```

## What lands where

Every record is imported **twice**, on purpose:

1. **Mirror tables (`Cc*`) — lossless, full fidelity.** Every known CreatorCore
   scalar becomes a typed column; arrays/objects become `Json`; and the *entire*
   original record is stored in `raw` — so no attribute is ever dropped, even ones
   not promoted to a column (e.g. `statistic-post`, whose schema we can't
   enumerate, is preserved whole). This is the "every column and attribute" store.
2. **Domain models (`Campaign`/`Post`/`Creator`) — the usable app layer.** Mapped
   for the app to consume, with the raw record also kept in `platformMetrics.__cc`.

Both are idempotent (mirror upserts by `ccId`; domain via `out/_idmap.json`).

## Notes

- `statistic-post` is the heaviest table and may keep timing out; each post also
  carries a `latestViews/Engagement` field used as the stats fallback.
- `out/` and `.profile/` are gitignored (bulk data + your login session).
