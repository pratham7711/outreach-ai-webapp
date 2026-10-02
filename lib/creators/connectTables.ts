import { db } from "@/lib/db";
import { CONNECT_TABLES } from "@/lib/creators/connectSchemaDdl";

/**
 * Whether the creator-connection tables exist yet on this database.
 *
 * They reach production through /api/admin/migrate-creator-connect, which
 * ships in the same deploy as the code that reads them, so for a while the code
 * is live and the tables are not. Every read and write of them asks this first
 * and degrades to today's behaviour: no grantor match beyond platformUserId, no
 * "Reconnect needed" mark, no connect links. Once true it stays true for the
 * life of the process; false is re-checked every minute.
 */
let ready = false;
let checkedAt = 0;

export async function connectTablesReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [...CONNECT_TABLES],
    );
    ready = rows[0]?.n === CONNECT_TABLES.length;
  } catch {
    ready = false;
  }
  return ready;
}

/** For tests. */
export function resetConnectTablesCache() {
  ready = false;
  checkedAt = 0;
}
