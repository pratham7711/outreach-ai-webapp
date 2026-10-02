import { db } from "@/lib/db";
import { ACCOUNT_ID_TABLES } from "@/lib/creators/accountIdSchemaDdl";

/**
 * Whether CreatorPlatformAccountId exists yet on this database.
 *
 * It reaches production through /api/admin/migrate-creator-account-ids, which
 * ships in the same deploy as the code that writes it, so for a few minutes
 * the code is live and the table is not. The writer asks this first and skips
 * the write rather than failing a read. Once true it stays true for the life of
 * the process; false is re-checked every minute. Same shape as rosterTables.
 */
let ready = false;
let checkedAt = 0;

export async function accountIdTablesReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [...ACCOUNT_ID_TABLES],
    );
    ready = rows[0]?.n === ACCOUNT_ID_TABLES.length;
  } catch {
    ready = false;
  }
  return ready;
}

/** For tests. */
export function resetAccountIdTablesCache() {
  ready = false;
  checkedAt = 0;
}
