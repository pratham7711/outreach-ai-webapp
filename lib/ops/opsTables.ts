import { OPS_TABLES } from "./opsSchemaDdl";

/**
 * Whether the ops-guard tables exist yet on this database, and the one way the
 * guards reach it.
 *
 * Same contract as rosterTablesReady: the tables reach production through
 * /api/admin/migrate-ops-guards, in the same deploy as the code that reads
 * them, so for a few minutes the code is live and the tables are not. Once
 * true it stays true for the life of the process; false is re-asked each
 * minute.
 *
 * The client is imported lazily, not at the top. These guards sit in front of
 * every cron route and every Sandbox boot, so their module is pulled into
 * tests that never asked for a database -- and @/lib/db builds a PrismaClient
 * on import. With no DATABASE_URL there is no database to ask, so the answer is
 * "absent" without a connection attempt; absent is always today's behaviour.
 */
let ready = false;
let checkedAt = 0;

export async function opsDb() {
  const { db } = await import("@/lib/db");
  return db;
}

export async function opsTablesReady(): Promise<boolean> {
  if (ready) return true;
  if (!process.env.DATABASE_URL) return false;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const db = await opsDb();
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [...OPS_TABLES],
    );
    ready = rows[0]?.n === OPS_TABLES.length;
  } catch {
    ready = false;
  }
  return ready;
}

/** For tests. */
export function resetOpsTablesCache() {
  ready = false;
  checkedAt = 0;
}
