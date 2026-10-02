import { QUOTA_TABLES } from "./quotaSchemaDdl";

/**
 * Whether the quota counter's table exists yet on this database. Same contract
 * as opsTablesReady (and rosterTablesReady before it): the table reaches
 * production through /api/admin/migrate-ops-quota in the same deploy as the
 * code that reads it, so for a few minutes the code is live and the table is
 * not. Once true it stays true for the life of the process; false is re-asked
 * each minute. No DATABASE_URL means no database to ask, so "absent" without a
 * connection attempt -- the YouTube reader that counts through this is pulled
 * into tests that never asked for a database.
 */
let ready = false;
let checkedAt = 0;
let inflight: Promise<boolean> | null = null;

export async function quotaDb() {
  const { db } = await import("@/lib/db");
  return db;
}

async function check(): Promise<boolean> {
  try {
    const db = await quotaDb();
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [...QUOTA_TABLES],
    );
    ready = rows[0]?.n === QUOTA_TABLES.length;
  } catch {
    ready = false;
  }
  return ready;
}

export async function quotaTablesReady(): Promise<boolean> {
  if (ready) return true;
  if (!process.env.DATABASE_URL) return false;
  if (inflight) return inflight;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  inflight = check().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** For tests. */
export function resetQuotaTablesCache() {
  ready = false;
  checkedAt = 0;
  inflight = null;
}
