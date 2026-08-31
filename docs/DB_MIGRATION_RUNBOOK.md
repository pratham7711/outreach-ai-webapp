# Production database move — runbook

**Why:** production compute runs in Vercel `iad1` (Ashburn, Virginia) while the
database sits in Neon `ap-southeast-1` (Singapore). Every query crosses the
Pacific, and prod/dev/test/CI-preview branches all draw down **one project's**
data-transfer allowance. That allowance is now exhausted:
`/api/public/marketplace` returns 500 and `/explore` renders an empty shell.

**Decision:** stay on **Neon**, long term. New project in `aws-us-east-1`, Launch
tier, production only. Dev and test stay on the existing free project.

Neon Launch has **no base fee** — billing is pure consumption, no monthly
minimum: $0.106/CU-hour compute, $0.35/GB-month storage, 500 GB egress included
per project then $0.10/GB, $1.50/branch-month past 10 branches. At our size
(~0.5 GB, business-hours traffic, 3 daily crons, scale-to-zero after 5 min idle)
that lands around **$3–8/month**. The "$19/mo" figure quoted elsewhere is simply
what ~180 CU-hours costs, i.e. one always-on 0.25 CU instance.

### Why Neon, and why we stop shopping

The outage was **not** a Neon limitation. It was three self-inflicted config
errors, none of which changing vendor would fix:

1. Database in `ap-southeast-1`, compute in `iad1` — every query crossed the Pacific.
2. Prod, dev, test and CI preview branches all inside **one project**, sharing one allowance.
3. A 5 GB free-tier egress cap serving client production, with nothing watching it.

The deciding factor is architectural, not financial: **we deploy on Vercel
serverless.** Every function invocation wants a connection, and Neon is built for
that shape — a pooled endpoint (`-pooler`, which we already use) and scale-to-zero.
A conventional box-priced managed Postgres would be flatter to budget but hands us
a connection-exhaustion problem we do not currently have, at the entry tiers where
connection ceilings are tightest.

| Option | Cost | Verdict |
|---|---|---|
| **Neon Launch, us-east-1** | **~$3–8/mo, $0 base** | **Chosen.** Serverless-native pooling, scale-to-zero, zero code change, already our provider |
| DigitalOcean Managed PG | $15.15/mo flat | Genuinely good and perfectly predictable, but tight connection ceiling at entry tier vs serverless |
| Render Basic-1gb | ~$22/mo | Same shape as DO, more money |
| Supabase Pro | $25/mo | More money, *less* egress (250 GB), and we use NextAuth so the bundled auth/storage is dead weight |
| Hetzner CX23 Ashburn | ~$6/mo | Cheapest, 20 TB traffic — but you own backups, PITR, patching, failover, pager. Email-only support, no phone |
| Oracle Always Free ARM | $0 | Halved June 2026 (4 OCPU→2) with no notice; began terminating over-limit instances 18 Aug 2026 |
| AWS RDS free tier | $0 → cliff | Accounts after 15 Jul 2025 get $100–200 **expiring credits**, not 12 months free |
| Azure PG Flexible | $0 → cliff | 750h B1MS + 32 GB, **12 months only** |
| GCP Cloud SQL | $0 → cliff | **No free tier at all**; $300 trial credits |
| DynamoDB | n/a | Ground-up rewrite: 55 relational models, joins, transactions, `$queryRaw` |

The three cliff options hand the client a bill shock ~12 months in — disqualifying
for a handover regardless of the headline "free".

**Committing to one provider costs us no optionality.** This is plain Postgres on
the standard `pg` driver via `@prisma/adapter-pg` — no Neon-specific SQL, no
proprietary client. `pg_dump` moves us anywhere in an afternoon, permanently. That
is the real insurance, and it is why the Databricks acquisition is a tolerable
risk: since the May 2025 deal, storage dropped $1.75 → $0.35/GB-month and compute
fell 15–25%, so pricing has moved in our favour, and if that ever reverses the
exit is one afternoon.

**Guard rail:** set a Neon spend alert at **$40/month**. Below that, consumption
billing is strictly cheaper than any flat box. Above it — roughly 2–3 always-on
compute units, meaning traffic has stopped being bursty — a flat $15.15/mo
DigitalOcean instance becomes the better deal and it is time to revisit. Alert on
spend, not on quota; quota is what failed silently this time.

---

---

## Hosting: stay on Vercel Pro

Evaluated properly against Fly.io, Render, Railway, Cloud Run, Cloudflare and
Netlify, on the assumption that migrating is one evening's work (the Dockerfile
already builds without `output: 'standalone'` — it copies `.next` +
`node_modules` and runs `next start`), and that performance is a hard requirement.

**Realistic all-in monthly cost:**

| Stack | Compute | DB | Domain | **Total** |
|---|---|---|---|---|
| **Vercel Pro + Neon** | $20 (incl. $20 usage credit, 1 TB transfer, 10M edge req) | ~$5 | ~$1.25 | **~$26** |
| Fly.io 2×shared-cpu-2x 1GB `iad` (HA) | $13.28 + ~$0.40 bandwidth | ~$5 | ~$1.25 | ~$20 |
| Fly.io 1×shared-cpu-2x 1GB (no HA) | $6.64 + ~$0.40 | ~$5 | ~$1.25 | ~$13 |
| Render Pro workspace + Starter | $25 + $7 | ~$5 | ~$1.25 | ~$38 |
| Railway | $15–27, **uncapped** | ~$5 | ~$1.25 | ~$21–33 |

Two corrections to earlier assumptions:

- **Render is no longer the cheap option.** Since 23 Apr 2026 it dropped per-seat
  fees but the Pro workspace is $25/mo *before* instance cost — $32+/mo total,
  more expensive than Vercel.
- **Vercel Pro's $20 is not a tax on top of usage.** The platform fee *includes*
  $20 of usage credit plus 1 TB Fast Data Transfer and 10M edge requests. A B2B
  dashboard with a few dozen daily users will not approach those, so it stays $20
  flat — including as tenants are added. The cost argument for migrating therefore
  does not improve with scale, which is the usual reason to migrate.

**Performance is a wash once the database is co-located, which is the whole point
of this runbook.** The current 3.9s `/explore` is the Pacific crossing, not the
host. After the move the residual differences are second-order in both directions:

- Fly wins on always-warm processes (no cold start) and a direct Neon endpoint,
  which keeps prepared statements — Vercel's serverless model needs the pooled
  endpoint, and PgBouncer transaction mode disables them. Real, but single-digit
  milliseconds on indexed queries.
- Vercel wins on global CDN for static assets. The team is in India and the app is
  US-hosted; a Next.js dashboard ships a lot of JS, and first load from a nearby
  edge beats one from Ashburn. Fly would need Cloudflare in front to match.

So the deciding factors are the non-performance ones: Vercel is the **only
verified Next.js 16 adapter** (with Bun — Cloudflare's and Netlify's integrations
are explicitly *not* built on the Adapter API and *not* verified, so compatibility
"may vary"), and it provides redundancy, zero-downtime deploys and preview
environments that a single Fly machine does not. Max saving from leaving is
~$6/mo with HA, for owning deploys, monitoring and uptime on a client system.

**Not locked in.** All three cron routes are `CRON_SECRET`-gated plain HTTP, so
any scheduler can drive them — GitHub Actions, a Fly scheduled machine, anything.
Combined with the working Dockerfile, leaving stays a one-evening option.

**Revisit if either happens:** the Vercel bill exceeds the $20 credit in a month,
or p95 dashboard latency stays above ~800 ms after this migration. Then Fly.io
`iad` is the target — it is the same metro as Neon `us-east-1` and exactly where
the TikTok fetcher is proven to work.

---

## Hard ordering constraint (verified 2026-08-21)

**Upgrade the Neon plan BEFORE attempting the dump.** The quota block rejects
*all* reads, not just large ones — a bare `select 1` against the current project
returns:

```
ERROR:  Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.
```

A `pg_dump` is a large read, so it cannot run while the project is capped. There
is no workaround and no way to export the data first. Sequence is therefore:

1. Upgrade the **existing** project to Launch → restores read access.
2. Create the **new** `aws-us-east-1` project.
3. Dump from old, restore into new.
4. Repoint `DATABASE_URL`, deploy.
5. Keep the old project 7 days, then delete.

### Step 6, which was missed: check `vercel.json` regions afterwards

The move above put the database in `us-east-1` on 21 Aug so it would sit beside
`iad1` compute. Two days later `d64601a` — "Run the functions next to the
database" — set `"regions": ["sin1"]`, moving compute to Singapore to join a
database that had left Singapore that same week.

The gap reopened in the opposite direction and stayed open for eight days:
functions in `sin1`, database in `us-east-1`, roughly 220 ms per round trip.
`GET /api/campaigns/[id]` issues about nine queries inside one include, so the
page paid a couple of seconds of pure network before doing any work. Confirmed
live from the response header `x-vercel-id: fra1::sin1::…` while
`DATABASE_URL` pointed at `…us-east-1.aws.neon.tech`. Restored to `iad1`.

Both changes were correct in isolation and were reasoned from the layout as it
stood *before the other one landed*. The lesson is not "sin1 was wrong" — it is
that **region is not an independent setting**. `vercel.json` `regions` and the
Neon project region are one decision expressed in two files, and neither file
mentions the other. Whichever moves first, verify the other in the same change,
and confirm with the deployed `x-vercel-id` rather than the committed config —
they disagreed here for over a week.

## Automated path

`scripts/neon-migrate.sh` does steps 2–4's mechanics in one command, with the
safety checks this migration needs. Credentials come from the environment and are
never printed — only hostnames are echoed.

```bash
brew install libpq                                  # provides pg_dump/pg_restore/psql

export OLD_DB='postgresql://...ap-southeast-1...'   # DIRECT endpoint, not -pooler
export NEW_DB='postgresql://...us-east-1...'        # DIRECT endpoint, not -pooler

scripts/neon-migrate.sh preflight                   # checks only, changes nothing
scripts/neon-migrate.sh run                         # dump, restore, verify
```

It refuses to proceed if: either URL is a `-pooler` endpoint (the pooler is
transaction-scoped and cannot hold restore locks), source and target are the same
host, the target already has tables in `public`, the dump comes out empty, the
restore reports any error, or the row counts do not match afterwards. It strips
Prisma-only query params (`pgbouncer`, `connection_limit`) that libpq rejects and
forces `sslmode=require`.

The manual equivalent is documented below if you would rather drive it by hand.

## Preconditions

- Neon dashboard access.
- `pg_dump` / `pg_restore` **17.x** locally (`brew install postgresql@17`).
  Version must be ≥ the server version or the dump will refuse to run.
- Nobody writing to prod during the cutover (~10 min for 33k rows).

> **Critical:** production has **no `_prisma_migrations` table** — the schema was
> applied with `prisma db push`, not `migrate deploy`. Do **not** run
> `npx prisma migrate deploy` against prod at any point; it will try to replay
> history that was never recorded. The dump/restore below carries schema **and**
> data verbatim and sidesteps migration history entirely.

## 1. Create the target

Neon console → **New Project**
- Region: **AWS US East (N. Virginia)** — `aws-us-east-1`
- Postgres: match the current major version
- Name: `outreach-prod` (production only — never add dev/test branches here)
- Plan: **Launch**

Copy the pooled connection string (`-pooler`).

## 2. Dump production

```bash
# OLD = current Singapore prod URL, NEW = the us-east-1 URL just created.
# Use the DIRECT (non-pooler) URL for both dump and restore.
export OLD_DB='postgresql://...ap-southeast-1...'
export NEW_DB='postgresql://...us-east-1...'

pg_dump "$OLD_DB" \
  --format=custom --no-owner --no-privileges --verbose \
  --file=prod-$(date +%Y%m%d-%H%M).dump
```

Confirm the dump is non-trivial (expect single-digit MB, not zero bytes):

```bash
ls -lh prod-*.dump
```

## 3. Restore

```bash
pg_restore --dbname="$NEW_DB" --no-owner --no-privileges \
  --verbose --exit-on-error prod-YYYYMMDD-HHMM.dump
```

## 4. Verify before cutting over

Row counts must match on both sides:

```bash
for url in "$OLD_DB" "$NEW_DB"; do
  echo "--- $url" | sed 's/:[^:@]*@/:****@/'
  psql "$url" -At -c "
    SELECT 'organizations', count(*) FROM \"Organization\"
    UNION ALL SELECT 'users',      count(*) FROM \"User\"
    UNION ALL SELECT 'campaigns',  count(*) FROM \"Campaign\"
    UNION ALL SELECT 'creators',   count(*) FROM \"Creator\"
    UNION ALL SELECT 'posts',      count(*) FROM \"Post\"
    UNION ALL SELECT 'snapshots',  count(*) FROM \"PostMetricSnapshot\";"
done
```

Also confirm the enum/extension surface came across:

```bash
psql "$NEW_DB" -At -c "SELECT count(*) FROM pg_type WHERE typtype='e';"
psql "$NEW_DB" -At -c "SELECT extname FROM pg_extension ORDER BY 1;"
```

## 5. Cut over

```bash
cd webapp
vercel env rm  DATABASE_URL production
vercel env add DATABASE_URL production   # paste the -pooler us-east-1 URL
vercel --prod
```

> Production deploys are blocked unless `HEAD` is authored by
> `prathamsharma7711@gmail.com`. Check `git log -1 --format='%ae'` first.

## 6. Confirm the fix

```bash
curl -s -o /dev/null -w 'marketplace=%{http_code} %{time_total}s\n' \
  https://campaign.madeboring.com/api/public/marketplace
curl -s -o /dev/null -w 'explore=%{http_code} %{time_total}s\n' \
  https://campaign.madeboring.com/explore
```

Expect `marketplace=200` (currently 500) and `/explore` well under 1s
(currently 3.9s — that gap is the Pacific round trip).

## 7. Keep the old project as a rollback window

Do **not** delete the Singapore project for 7 days. To roll back, re-point
`DATABASE_URL` at `$OLD_DB` and redeploy. After 7 days, delete it to stop
storage billing — but keep the local `.dump` file.

---

## Follow-ups (not part of the cutover)

1. **Cut egress at the source.** Marketplace/creator search runs 23
   case-insensitive `contains` queries (→ `ILIKE '%term%'`). `Creator.handle`
   carries no index at all, and a b-tree could not serve a leading wildcard
   anyway, so every search seq-scans and ships full rows. This is the "do we
   need Elasticsearch?" answer — we don't:

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE INDEX CONCURRENTLY idx_creator_handle_trgm
     ON "Creator" USING gin (handle gin_trgm_ops);
   ```

   CreatorCore only has Elasticsearch because Bubble.io uses it as platform
   infrastructure for every app-database search — it was inherited, not chosen.
   At 18.7k rows a trigram GIN index is faster and adds no service to operate.

2. **Set the $40/month spend alert** described above, before the cutover rather
   than after. The current outage had no warning because nothing was watching.

3. **Delete `.github/workflows/neon_workflow.yml` in the parent repo**
   (`pratham7711/outreach-ai`). It creates a Neon branch inside
   `NEON_PROJECT_ID` on every PR `synchronize`, deletes it only on PR `closed`,
   and its `concurrency` block has no `cancel-in-progress`, so pushes stack. It
   has never actually fired (that repo has zero PRs) and it cannot succeed —
   the parent repo gitignores `webapp/`, so its `npm ci` step has no
   `package-lock.json` to install from. It is a latent quota trap with no
   upside. The webapp repo's own `ci.yml` already covers schema validation
   against a throwaway `postgres` service container.

4. **Re-extract `statistic-post`** before CreatorCore is switched off.
   `scripts/creatorcore/out/statistic-post.jsonl` is **0 records** — per-post
   metrics history was never captured. Once the CreatorCore account lapses that
   history is unrecoverable.
