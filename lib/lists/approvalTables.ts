import { db } from "@/lib/db";
import { LIST_APPROVAL_TABLES } from "@/lib/lists/approvalSchemaDdl";

/**
 * Whether the list-approval tables exist yet on this database.
 *
 * They reach production through /api/admin/migrate-list-approval, which ships
 * in the same deploy as the code that reads them, so for a few minutes the
 * code is live and the tables are not. Everything that reads or writes them
 * asks this first and, while it is false, behaves exactly as Lists did before
 * the approval loop existed. Once true it stays true for the life of the
 * process; false is re-checked every minute.
 */
let ready = false;
let checkedAt = 0;

export async function listApprovalTablesReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [...LIST_APPROVAL_TABLES],
    );
    ready = rows[0]?.n === LIST_APPROVAL_TABLES.length;
  } catch {
    ready = false;
  }
  return ready;
}

/** For tests. */
export function resetListApprovalTablesCache() {
  ready = false;
  checkedAt = 0;
}
