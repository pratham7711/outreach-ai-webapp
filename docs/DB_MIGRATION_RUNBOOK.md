# Production database move — runbook

**Why:** production compute runs in Vercel `iad1` (Ashburn, Virginia) while the
database sits in Neon `ap-southeast-1` (Singapore). Every query crosses the
Pacific, and prod/dev/test/CI-preview branches all draw down **one project's**
data-transfer allowance. That allowance is now exhausted:
`/api/public/marketplace` returns 500 and `/explore` renders an empty shell.

**Decision:** new Neon project in `aws-us-east-1`, Launch tier ($19/mo),
production only. Dev and test stay on the existing free project.

Why not the "free" alternatives — all of them are worse for a client handover:

| Option | Cost | Verdict |
|---|---|---|
| **Neon Launch, us-east-1** | **$19/mo** | **Chosen.** 500 GB egress (100×), 10 GB storage, same driver, zero code change |
| Supabase Pro | $25/mo | More money, *less* egress (250 GB), new provider, no branching |
| Hetzner CX23 Ashburn | ~$6/mo | Saves $13/mo; you own backups, PITR, patching, failover, pager. Email-only support |
| Oracle Always Free ARM | $0 | Halved June 2026 (4 OCPU→2) with no notice; began terminating over-limit instances 18 Aug 2026. Not for client production |
| AWS RDS free tier | $0 → cliff | Accounts after 15 Jul 2025 get $100–200 **expiring credits**, not 12 months free |
| Azure PG Flexible | $0 → cliff | 750h B1MS + 32 GB, **12 months only** |
| GCP Cloud SQL | $0 → cliff | **No free tier at all**; $300 trial credits |

The three cliff options hand the client a bill shock ~12 months in. The $19 buys
egress headroom and managed PITR, not features.

---

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

2. **Set a Neon spend alert** at 50% of the egress allowance. The current
   outage had no warning because nothing was watching.

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
