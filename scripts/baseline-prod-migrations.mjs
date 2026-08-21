#!/usr/bin/env node
/**
 * Baselines a database that was created by `prisma db push` so that
 * `prisma migrate deploy` can take over.
 *
 * The production database has no _prisma_migrations table, so migrate deploy
 * fails P3005. The fix is to mark every migration whose effects are already
 * present as applied, and let deploy run only the genuine remainder.
 *
 * Read-only by default: prints the plan and exits. Pass --apply to execute.
 *
 *   DATABASE_URL="<prod url>" node scripts/baseline-prod-migrations.mjs
 *   DATABASE_URL="<prod url>" node scripts/baseline-prod-migrations.mjs --apply
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const APPLY = process.argv.includes("--apply");

// A migration counts as already reflected when its marker is present in the
// live schema. Markers are the narrowest thing each migration created.
const MARKERS = {
  "20260329152906_foundation_postgresql_all_models": { table: "Organization" },
  "20260330160119_campaign_payment_posts_phase_a": { table: "Post" },
  "20260330181331_marketplace_phase2b": { table: "Activation" },
  "20260330192354_view_ledger_model": { table: "ViewLedgerEntry" },
  "20260720150902_viewscount_to_double_precision": { column: ["Post", "viewsCount"] },
  "20260720165317_widen_metric_counts_to_double_precision": { column: ["Post", "likesCount"] },
  "20260812040000_add_platform_enum_values": { enumValue: ["Platform", "FACEBOOK"] },
  "20260812041000_add_activation_draft_fields": { column: ["Activation", "draftUrl"] },
  "20260814000000_song_phase_and_platforms": { table: "Song" },
};

function migrationNames() {
  if (!existsSync(MIGRATIONS_DIR)) throw new Error(`No migrations dir at ${MIGRATIONS_DIR}`);
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function tableExists(db, name) {
  const r = await db.query(
    "select 1 from information_schema.tables where table_schema='public' and table_name=$1",
    [name],
  );
  return r.rowCount > 0;
}

async function columnExists(db, table, column) {
  const r = await db.query(
    "select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2",
    [table, column],
  );
  return r.rowCount > 0;
}

async function enumValueExists(db, typeName, label) {
  const r = await db.query(
    "select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname=$1 and e.enumlabel=$2",
    [typeName, label],
  );
  return r.rowCount > 0;
}

async function isReflected(db, name) {
  const marker = MARKERS[name];
  if (!marker) return null;
  if (marker.table) return tableExists(db, marker.table);
  if (marker.column) return columnExists(db, ...marker.column);
  if (marker.enumValue) return enumValueExists(db, ...marker.enumValue);
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const db = new Client({ connectionString: url, connectionTimeoutMillis: 20000 });
  await db.connect();

  const host = new URL(url).host;
  const hasHistory = await tableExists(db, "_prisma_migrations");
  const recorded = new Set();
  if (hasHistory) {
    const r = await db.query("select migration_name from _prisma_migrations");
    for (const row of r.rows) recorded.add(row.migration_name);
  }

  const names = migrationNames();
  const unknown = names.filter((n) => !(n in MARKERS));
  const plan = [];
  for (const name of names) {
    if (recorded.has(name)) {
      plan.push({ name, action: "already recorded" });
      continue;
    }
    const reflected = await isReflected(db, name);
    if (reflected === null) plan.push({ name, action: "UNKNOWN — no marker, decide by hand" });
    else if (reflected) plan.push({ name, action: "mark applied (baseline)" });
    else plan.push({ name, action: "leave for migrate deploy to run" });
  }
  await db.end();

  console.log(`host: ${host}`);
  console.log(`_prisma_migrations: ${hasHistory ? `present, ${recorded.size} recorded` : "absent"}`);
  for (const p of plan) console.log(`  ${p.action.padEnd(34)} ${p.name}`);

  if (unknown.length) {
    console.error(`\nRefusing: ${unknown.length} migration(s) have no marker in this script.`);
    console.error("Add a marker for each before baselining:\n  " + unknown.join("\n  "));
    process.exit(2);
  }

  const toBaseline = plan.filter((p) => p.action === "mark applied (baseline)").map((p) => p.name);
  if (!APPLY) {
    console.log(`\nDry run. ${toBaseline.length} migration(s) would be marked applied.`);
    console.log("Re-run with --apply, then deploy so `prisma migrate deploy` runs the rest.");
    return;
  }

  for (const name of toBaseline) {
    console.log(`resolving --applied ${name}`);
    execFileSync("npx", ["prisma", "migrate", "resolve", "--applied", name], {
      stdio: "inherit",
      env: process.env,
    });
  }
  console.log(`\nBaselined ${toBaseline.length}. Now run: npx prisma migrate deploy`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
