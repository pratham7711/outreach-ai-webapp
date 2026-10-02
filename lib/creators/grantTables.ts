import { db } from "@/lib/db";
import { GRANT_TABLES } from "@/lib/creators/grantSchemaDdl";

/**
 * Whether the grant table exists yet on this database.
 *
 * It reaches production through /api/admin/migrate-creator-grants, which ships
 * in the same deploy as the code that reads it, so for a while the code is live
 * and the table is not. Every read and write of it asks this first and degrades
 * to today's behaviour: connections are read without a grant check, and no
 * grant is recorded. Once true it stays true for the life of the process; false
 * is re-checked every minute.
 *
 * `fresh` skips the one-minute negative cache. The writers use it — a connect
 * callback, a revoke — because they are rare and a grant missed in the minute
 * after the table appears is a connection the gate would then refuse. The hot
 * read path keeps the cache: reading ungated for one more minute is exactly
 * what it did yesterday.
 */
let ready = false;
let checkedAt = 0;

export async function grantTablesReady(options: { fresh?: boolean } = {}): Promise<boolean> {
  if (ready) return true;
  if (!options.fresh && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [...GRANT_TABLES],
    );
    ready = rows[0]?.n === GRANT_TABLES.length;
  } catch {
    ready = false;
  }
  return ready;
}

/** For tests. */
export function resetGrantTablesCache() {
  ready = false;
  checkedAt = 0;
}
