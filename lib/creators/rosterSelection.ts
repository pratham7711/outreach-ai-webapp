import { z } from "zod";
import { db } from "@/lib/db";
import { creatorOrderBy, creatorWhere, readCreatorFilters } from "@/lib/listFilters";
import { readCreatorSort } from "@/lib/listParams";
import { rosterTablesReady } from "@/lib/creators/rosterTables";

/**
 * Which creators a bulk action on the roster means.
 *
 * Either the rows someone ticked, or "everything matching", sent as the
 * roster's own query string and resolved here with the same parse and the
 * same where-clause the page used -- so "all 640" never travels as 640 ids,
 * and can never mean creators the page would not have shown. Both are scoped
 * to the caller's org, never to anything in the body.
 */

export const MAX_BULK_CREATORS = 5000;

export const rosterSelectionSchema = z.union([
  z.object({ creatorIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_BULK_CREATORS) }),
  z.object({ query: z.string().max(4000) }),
]);
export type RosterSelection = z.infer<typeof rosterSelectionSchema>;

export type ResolvedSelection = { ok: true; ids: string[] } | { ok: false; status: number; error: string };

export async function resolveRosterSelection(orgId: string, selection: RosterSelection): Promise<ResolvedSelection> {
  if ("creatorIds" in selection) {
    const ids = [...new Set(selection.creatorIds)];
    const found = await db.creator.findMany({ where: { id: { in: ids }, orgId, deletedAt: null }, select: { id: true } });
    if (found.length !== ids.length) {
      return { ok: false, status: 404, error: "One or more creators were not found in this organization" };
    }
    return { ok: true, ids };
  }

  const sp = Object.fromEntries(new URLSearchParams(selection.query.replace(/^\?/, "")));
  const where = creatorWhere(orgId, readCreatorFilters(sp), { roster: await rosterTablesReady() });
  const count = await db.creator.count({ where });
  if (count > MAX_BULK_CREATORS) {
    return { ok: false, status: 413, error: `That is ${count} creators; narrow the filters to ${MAX_BULK_CREATORS} or fewer.` };
  }
  const rows = await db.creator.findMany({ where, select: { id: true }, orderBy: creatorOrderBy(readCreatorSort(sp)) });
  return { ok: true, ids: rows.map((r) => r.id) };
}
