/**
 * Seed an org's Settings → General lists with what the reference ships.
 *
 *   node --env-file=.env scripts/seed-taxonomy.mjs [orgId]
 *
 * Idempotent: every insert is ON CONFLICT DO NOTHING against the
 * (orgId, name) unique index, so re-running adds only what is missing and
 * never disturbs a name the org has since renamed or removed.
 *
 * Statuses carry the bucket their name belongs to. Our CampaignStatus enum
 * already is the reference's four groups, so "Need To Invoice" and "Invoiced"
 * are both IN_PROGRESS -- named statuses inside the Active group, exactly as
 * the reference shows them.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const orgArg = process.argv[2];
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const orgs = orgArg
  ? { rows: [{ id: orgArg }] }
  : await c.query(`SELECT id, name FROM "Organization" ORDER BY "createdAt" LIMIT 1`);
if (!orgs.rows.length) { console.error("no organization found"); process.exit(1); }
const orgId = orgs.rows[0].id;
console.log(`seeding org ${orgId}${orgs.rows[0].name ? ` (${orgs.rows[0].name})` : ""}\n`);

const CAMPAIGN_STATUSES = [
  ["Pending", "PENDING", 0],
  ["In-Progress", "IN_PROGRESS", 1],
  ["Need To Invoice", "IN_PROGRESS", 2],
  ["Invoiced", "IN_PROGRESS", 3],
  ["Paid", "IN_PROGRESS", 4],
  ["Complete", "COMPLETE", 5],
  ["Paused", "CANCELLED", 6],
  ["Canceled", "CANCELLED", 7],
];

const ACTIVATION_STATUSES = [
  ["Pending", "AWAITING_DRAFT", 0],
  ["Invited", "AWAITING_DRAFT", 1],
  ["In-Progress", "POSTING", 2],
  ["Complete — Awaiting Payout", "POSTED", 3],
  ["Complete — Paid", "COMPLETE", 4],
  ["Canceled", "DECLINED", 5],
];

const CREATOR_FLAGS = [
  ["Fast Turnaround", "⚡", 0],
  ["Good Views", "👀", 1],
  ["Not Responding", "🚫", 2],
  ["On Break", "⏸️", 3],
];

const DELIVERABLE_TYPES = [
  ["Instagram Feed Post", "INSTAGRAM", 0],
  ["Instagram Story", "INSTAGRAM", 1],
  ["Instagram Reel", "INSTAGRAM", 2],
  ["TikTok Song Promo", "TIKTOK", 3],
  ["TikTok Brand Promo", "TIKTOK", 4],
];

async function seed(label, table, rows, columns, values) {
  let added = 0;
  for (const row of rows) {
    const cols = ["id", '"orgId"', ...columns].join(", ");
    const holders = row.map((_, i) => `$${i + 3}`).join(", ");
    const res = await c.query(
      `INSERT INTO "${table}" (${cols}) VALUES ($1, $2, ${holders})
         ON CONFLICT ("orgId", name) DO NOTHING`,
      [randomUUID(), orgId, ...values(row)],
    );
    added += res.rowCount;
  }
  const total = await c.query(`SELECT count(*)::int n FROM "${table}" WHERE "orgId"=$1`, [orgId]);
  console.log(`  ${label.padEnd(22)} +${added} added, ${total.rows[0].n} total`);
}

await seed("campaign statuses", "CampaignStatusDef", CAMPAIGN_STATUSES,
  ["name", "bucket", '"sortOrder"'], (r) => [r[0], r[1], r[2]]);
await seed("activation statuses", "ActivationStatusDef", ACTIVATION_STATUSES,
  ["name", "bucket", '"sortOrder"'], (r) => [r[0], r[1], r[2]]);
await seed("creator flags", "CreatorFlagDef", CREATOR_FLAGS,
  ["name", "emoji", '"sortOrder"'], (r) => [r[0], r[1], r[2]]);
await seed("deliverable types", "DeliverableTypeDef", DELIVERABLE_TYPES,
  ["name", "platform", '"sortOrder"'], (r) => [r[0], r[1], r[2]]);

// Creator tags and campaign tags are deliberately not seeded: the reference
// ships them empty ("No Campaign Tags Found") because they are the org's own
// vocabulary, not a default anyone would keep.
console.log("\n  creator tags / campaign tags left empty, as the reference ships them");

await c.end();
