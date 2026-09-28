import { db } from "@/lib/db";
import { ROSTER_TABLES } from "@/lib/creators/rosterSchemaDdl";

/**
 * Whether the roster tables exist yet on this database.
 *
 * They reach production through /api/admin/migrate-creator-roster, which ships
 * in the same deploy as the code that reads them, so for a few minutes the
 * code is live and the tables are not. Queries that join them ask this first
 * and leave the join out, rather than failing every roster page. Once true it
 * stays true for the life of the process; false is re-checked every minute.
 */
let ready = false;
let checkedAt = 0;

export async function rosterTablesReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [...ROSTER_TABLES],
    );
    ready = rows[0]?.n === ROSTER_TABLES.length;
  } catch {
    ready = false;
  }
  return ready;
}

/** For tests. */
export function resetRosterTablesCache() {
  ready = false;
  checkedAt = 0;
}
