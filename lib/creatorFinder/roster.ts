import { db } from "@/lib/db";

/**
 * Which of these handles are already on the org's roster, as a creator's own
 * account or as one of its linked profiles. Compared case-insensitively:
 * roster handles are free text from imports and the add form.
 */
export async function rosterMatches(
  orgId: string,
  platform: "INSTAGRAM" | "YOUTUBE",
  handles: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!handles.length) return found;
  const lower = [...new Set(handles.map((h) => h.toLowerCase()))];
  const withAt = lower.map((h) => `@${h}`);
  const [creators, links] = await Promise.all([
    db.creator.findMany({
      where: { orgId, platform, deletedAt: null, handle: { in: [...lower, ...withAt], mode: "insensitive" } },
      select: { id: true, handle: true },
    }),
    db.creatorProfileLink.findMany({
      where: { orgId, platform, handle: { in: [...lower, ...withAt], mode: "insensitive" }, creator: { deletedAt: null } },
      select: { creatorId: true, handle: true },
    }),
  ]);
  for (const c of creators) found.set(c.handle.replace(/^@/, "").toLowerCase(), c.id);
  for (const l of links) {
    const key = l.handle.replace(/^@/, "").toLowerCase();
    if (!found.has(key)) found.set(key, l.creatorId);
  }
  return found;
}

/**
 * Which of these handles reached the roster by signing up through the creator
 * portal, with the latest time each one landed there. Portal sign-up asks for
 * no platform, so the roster row it creates is TIKTOK whatever platform the
 * agency found the creator on (lib/marketplace/join.ts), and a platform match
 * never sees it. The caller only counts a row added after the card was made,
 * so an older, unrelated creator with the same handle elsewhere doesn't count.
 */
export async function portalSignups(orgId: string, handles: string[], since: Date): Promise<Map<string, Date>> {
  const found = new Map<string, Date>();
  if (!handles.length) return found;
  const lower = [...new Set(handles.map((h) => h.toLowerCase()))];
  const rows = await db.creator.findMany({
    where: {
      orgId,
      deletedAt: null,
      creatorUserId: { not: null },
      addedAt: { gte: since },
      handle: { in: [...lower, ...lower.map((h) => `@${h}`)], mode: "insensitive" },
    },
    select: { handle: true, addedAt: true },
  });
  for (const r of rows) {
    const key = r.handle.replace(/^@/, "").toLowerCase();
    const seen = found.get(key);
    if (!seen || r.addedAt > seen) found.set(key, r.addedAt);
  }
  return found;
}
