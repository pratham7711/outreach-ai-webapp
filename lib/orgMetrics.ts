import type { OrgUiConfig } from "./orgConfig";

/**
 * Which computed metrics a workspace shows.
 *
 * Deliberately free of any database import: lib/orgConfig pulls in lib/db, and
 * a pure predicate that cannot be unit-tested without booting Prisma is a
 * predicate that stops being tested.
 */

/**
 * Whether EMV is shown anywhere in this workspace.
 *
 * Defaults to TRUE on anything unrecognised — absent config, a legacy org that
 * predates the setting, a malformed value. EMV has been visible since launch,
 * so a parser that fell closed here would silently strip a column from every
 * existing workspace; only an explicit `false` hides it.
 *
 * This is the opposite default to lib/reports/shareVisibility, and deliberately
 * so: that parser guards what an anonymous visitor on a public URL is shown, so
 * it must fail closed. This one guards a logged-in operator's own workspace.
 */
export function emvEnabled(config: OrgUiConfig | null | undefined): boolean {
  return config?.metrics?.showEmv !== false;
}

/** Same question, straight off the raw `uiConfig` JSON column. */
export function emvEnabledFromRaw(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
  const metrics = (raw as { metrics?: unknown }).metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return true;
  return (metrics as { showEmv?: unknown }).showEmv !== false;
}
