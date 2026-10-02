import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { grantsForCreator } from "@/lib/creators/grants";
import { entriesToShow } from "@/lib/creators/grantAccess";
import { accountStatesFor } from "@/lib/platforms/accountState";

export const dynamic = "force-dynamic";

/**
 * GET /api/creators/[id]/grants — what this org may read for one creator.
 *
 * Only this org's grants (the session's org, never one from the request), and
 * never a handle, token or account id: the panel needs dates, scopes and a
 * status, nothing else. `tracked` is false while the grant table does not
 * exist yet, so the panel can say that rather than show an empty list as if
 * nothing had been granted.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const creator = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const connections = await db.creatorSocialAccount.findMany({
    where: { creatorId: id, creator: { orgId } },
    select: { id: true },
  });
  const connectionIds = connections.map((c) => c.id);

  const grants = await grantsForCreator(orgId, id, connectionIds);
  if (grants === null) return NextResponse.json({ tracked: false, entries: [] });

  const states = await accountStatesFor(connectionIds);
  const reconnectNeeded = new Set(
    [...states].filter(([, s]) => Boolean(s.reconnectNeededAt)).map(([accountId]) => accountId),
  );
  return NextResponse.json({
    tracked: true,
    entries: entriesToShow(grants, new Set(connectionIds), reconnectNeeded),
  });
}
