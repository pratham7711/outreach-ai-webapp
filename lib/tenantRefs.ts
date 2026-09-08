import { db } from "@/lib/db";

/**
 * Proving that an id in a request body belongs to the caller's org.
 *
 * Every route here already takes orgId from the session and never from the
 * body — but a foreign-key field like `clientId` is an id in the body that gets
 * written straight onto a row the caller does own. Nothing about the campaign
 * row is then wrong from Prisma's point of view, and the next render joins the
 * relation and prints another tenant's client name on this tenant's page. The
 * write is the leak, one page load later.
 *
 * The campaign PATCH route already guarded `songId` this way, with the same
 * reasoning in a comment. This is that guard, shared, so the fields cannot
 * drift apart on which of them is checked.
 */
export type TenantRefs = {
  clientId?: string | null;
  folderId?: string | null;
  songId?: string | null;
  statusDefId?: string | null;
  /**
   * A report's subject campaign. Unlike the others this one is not merely a
   * label on a page: a Report can be made public, and a report row pointing at
   * another org's campaign turns that org's performance into a share link the
   * pointing org controls.
   */
  campaignId?: string | null;
};

export type ForeignRef = "client" | "folder" | "song" | "status" | "campaign";

/**
 * Returns the first reference that does not belong to the org, or null when
 * every supplied reference checks out. Nulls and undefined are skipped —
 * clearing a field is not a cross-tenant reference.
 */
export async function findForeignRef(orgId: string, refs: TenantRefs): Promise<ForeignRef | null> {
  const checks: Promise<ForeignRef | null>[] = [];

  if (refs.clientId) {
    checks.push(
      db.client
        .findFirst({ where: { id: refs.clientId, orgId }, select: { id: true } })
        .then((row) => (row ? null : ("client" as const)))
    );
  }
  if (refs.folderId) {
    checks.push(
      db.folder
        .findFirst({ where: { id: refs.folderId, orgId }, select: { id: true } })
        .then((row) => (row ? null : ("folder" as const)))
    );
  }
  if (refs.songId) {
    checks.push(
      db.song
        .findFirst({ where: { id: refs.songId, orgId, deletedAt: null }, select: { id: true } })
        .then((row) => (row ? null : ("song" as const)))
    );
  }
  if (refs.statusDefId) {
    checks.push(
      db.campaignStatusDef
        .findFirst({ where: { id: refs.statusDefId, orgId }, select: { id: true } })
        .then((row) => (row ? null : ("status" as const)))
    );
  }

  if (refs.campaignId) {
    checks.push(
      db.campaign
        .findFirst({ where: { id: refs.campaignId, orgId, deletedAt: null }, select: { id: true } })
        .then((row) => (row ? null : ("campaign" as const)))
    );
  }

  if (checks.length === 0) return null;
  // Order follows TenantRefs, not completion, so the same bad request always
  // names the same field.
  const results = await Promise.all(checks);
  return results.find((r) => r !== null) ?? null;
}
