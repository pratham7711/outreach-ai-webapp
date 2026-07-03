import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const orgScope = { campaign: { orgId } };

  const [totalRows, syncedRows, neverRows, deadRows, sealedRows, deadLetterPosts, snapshotGroups] = await Promise.all([
    db.post.groupBy({ by: ["platform"], where: orgScope, _count: { _all: true }, _max: { lastSyncedAt: true } }),
    db.post.groupBy({ by: ["platform"], where: { ...orgScope, lastSyncedAt: { gte: since } }, _count: { _all: true } }),
    db.post.groupBy({ by: ["platform"], where: { ...orgScope, lastSyncedAt: null }, _count: { _all: true } }),
    db.post.groupBy({ by: ["platform"], where: { ...orgScope, syncDisabledAt: { not: null } }, _count: { _all: true } }),
    db.post.groupBy({ by: ["platform"], where: { ...orgScope, snapshots: { some: { isFinalSnapshot: true } } }, _count: { _all: true } }),
    db.post.findMany({
      where: { ...orgScope, syncDisabledAt: { not: null } },
      select: {
        id: true,
        postUrl: true,
        platform: true,
        syncFailCount: true,
        syncDisabledAt: true,
        campaign: { select: { title: true } },
      },
      orderBy: { syncDisabledAt: "desc" },
      take: 20,
    }),
    db.postMetricSnapshot.groupBy({
      by: ["syncSource"],
      where: { recordedAt: { gte: since }, post: { campaign: { orgId } } },
      _count: { _all: true },
    }),
  ]);

  const countOf = (rows: { platform: string; _count: { _all: number } }[], platform: string) =>
    rows.find((r) => r.platform === platform)?._count._all ?? 0;

  const perPlatform = PLATFORMS.map((platform) => {
    const totalRow = totalRows.find((r) => r.platform === platform);
    return {
      platform,
      total: totalRow?._count._all ?? 0,
      syncedLast24h: countOf(syncedRows, platform),
      neverSynced: countOf(neverRows, platform),
      deadLettered: countOf(deadRows, platform),
      sealed: countOf(sealedRows, platform),
      lastSyncAt: totalRow?._max.lastSyncedAt ?? null,
    };
  });

  const deadLetter = deadLetterPosts.map((p) => ({
    id: p.id,
    postUrl: p.postUrl,
    platform: p.platform,
    syncFailCount: p.syncFailCount,
    syncDisabledAt: p.syncDisabledAt,
    campaignTitle: p.campaign?.title ?? null,
  }));

  const recentSnapshots = snapshotGroups.map((g) => ({
    syncSource: g.syncSource ?? "unknown",
    count: g._count._all,
  }));

  return NextResponse.json({ perPlatform, deadLetter, recentSnapshots });
}
