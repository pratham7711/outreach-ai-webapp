import { db } from "@/lib/db";
import { FEEDBACK_TABLES } from "@/lib/feedback/feedbackSchemaDdl";

/**
 * Whether the Feedback table exists yet on this database.
 *
 * It reaches production through /api/admin/migrate-feedback, so for a while
 * the button can be live and the table not. The routes ask this first and,
 * while it is false, answer that feedback cannot be taken yet rather than
 * failing on a missing relation. Once true it stays true for the life of the
 * process; false is re-checked every minute.
 */
let ready = false;
let checkedAt = 0;

export async function feedbackTablesReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [...FEEDBACK_TABLES],
    );
    ready = rows[0]?.n === FEEDBACK_TABLES.length;
  } catch {
    ready = false;
  }
  return ready;
}

/** For tests. */
export function resetFeedbackTablesCache() {
  ready = false;
  checkedAt = 0;
}
