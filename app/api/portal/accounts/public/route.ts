import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { stripAt } from "@/lib/format";

/**
 * GET /api/portal/accounts/public -- the "Public only" rows on My accounts.
 *
 * An agency can track a creator from their public profile without the creator
 * ever connecting anything (the roster's tracker sweep, lib/creators/snapshot.ts).
 * The creator should see that too: which of their profiles we read publicly,
 * and when we last did. A profile on a platform the creator has connected is
 * left out -- that one is listed as Connected instead.
 *
 * Gated on proven ownership (lib/portal/creatorLink.ts), like every other read
 * of a creator's own data: a handle match alone would let anyone see which
 * agencies track a handle they registered.
 */
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const linked = await findLinkedCreatorsForHandle(session);
    if (linked.length === 0) return NextResponse.json({ profiles: [] });
    const ids = linked.map((c) => c.id);

    const [rows, accounts] = await Promise.all([
      db.creator.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, platform: true, handle: true },
      }),
      db.creatorSocialAccount.findMany({
        where: { OR: [{ creatorId: { in: ids } }, { creatorUserId: session.creatorUserId }] },
        select: { creatorId: true, platform: true, handle: true, origin: true },
      }),
    ]);

    const connectedPlatforms = new Set(
      accounts.filter((a) => a.origin !== "manual").map((a) => a.platform),
    );

    /* The roster row's own platform and handle, plus any account an agency
       typed in by hand: both are public profiles nobody authorised. */
    const candidates = [
      ...rows.map((r) => ({ creatorId: r.id, platform: r.platform as string, handle: r.handle })),
      ...accounts
        .filter((a) => a.origin === "manual" && a.creatorId && ids.includes(a.creatorId))
        .map((a) => ({ creatorId: a.creatorId as string, platform: a.platform as string, handle: a.handle })),
    ];

    const byKey = new Map<string, { platform: string; handle: string; creatorIds: string[] }>();
    for (const c of candidates) {
      if (connectedPlatforms.has(c.platform as never)) continue;
      const handle = stripAt(c.handle).trim();
      if (!handle) continue;
      const key = `${c.platform}:${handle.toLowerCase()}`;
      const entry = byKey.get(key) ?? { platform: c.platform, handle, creatorIds: [] };
      entry.creatorIds.push(c.creatorId);
      byKey.set(key, entry);
    }

    const profiles = await Promise.all(
      [...byKey.values()].map(async (p) => {
        const last = await db.creatorTrackerSnapshot.findFirst({
          where: { creatorId: { in: p.creatorIds } },
          orderBy: { recordedAt: "desc" },
          select: { recordedAt: true },
        });
        return {
          platform: p.platform,
          handle: p.handle,
          lastReadAt: last?.recordedAt.toISOString() ?? null,
        };
      }),
    );

    return NextResponse.json({ profiles });
  } catch (error) {
    console.error("Failed to list public profiles:", error);
    return NextResponse.json({ error: "Failed to load public profiles" }, { status: 500 });
  }
}
