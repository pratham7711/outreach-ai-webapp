// One-shot CreatorCore sync endpoint.
//
// Production's Vercel build command is plain `next build`, so migrations never
// run there and the prod DATABASE_URL is a Vercel "sensitive" variable, which is
// write-only and cannot be read back by any API or UI. That leaves no way to
// reach the prod database from a laptop — so the migration and the bulk load run
// *inside* prod instead, where DATABASE_URL is already in the environment.
//
// Safety properties:
//   - Inert unless CC_SYNC_TOKEN is set: without it every method 404s, so the
//     route does not exist as far as an unauthenticated caller can tell.
//   - orgId and createdById are resolved server-side and overwrite whatever the
//     payload claims, so a caller can never write into another tenant.
//   - Only the whitelisted tables below are writable, and only via createMany —
//     there is no arbitrary-SQL path. The DDL it can run is the fixed, reviewed
//     list in lib/creatorcore/parityDdl.ts.
//   - Loads are additive (skipDuplicates) and keyed on the CreatorCore source id,
//     so a re-run resumes rather than duplicating, and pre-existing rows that did
//     not come from CreatorCore are never touched.
//
// Retire it by removing CC_SYNC_TOKEN from the Vercel project once the sync is done.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PARITY_DDL, DRIFT_REPAIR_DDL } from "@/lib/creatorcore/parityDdl";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Inject = "org" | "orgAndCreator" | "none";

// table name accepted in the payload -> Prisma delegate + what the server injects
const LOADABLE: Record<string, { delegate: string; inject: Inject }> = {
  ccCampaign: { delegate: "ccCampaign", inject: "org" },
  ccPost: { delegate: "ccPost", inject: "org" },
  ccStatisticPost: { delegate: "ccStatisticPost", inject: "org" },
  ccRefreshQueue: { delegate: "ccRefreshQueue", inject: "org" },
  ccRecord: { delegate: "ccRecord", inject: "org" },
  creator: { delegate: "creator", inject: "org" },
  campaign: { delegate: "campaign", inject: "orgAndCreator" },
  post: { delegate: "post", inject: "none" },
};

function authorize(request: NextRequest) {
  const token = process.env.CC_SYNC_TOKEN;
  if (!token) return { ok: false as const, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return { ok: false as const, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const };
}

// The target org is whichever org the admin account belongs to, else the only
// org present. Never taken from the request.
async function resolveTarget() {
  const admin = await db.user.findFirst({ where: { email: "admin@demo.com" }, select: { id: true, orgId: true } });
  if (admin?.orgId) return { orgId: admin.orgId, userId: admin.id };
  const org = await db.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error("no Organization in the database");
  const user = await db.user.findFirst({ where: { orgId: org.id }, select: { id: true } });
  if (!user) throw new Error(`org ${org.id} has no users; Campaign.createdById needs one`);
  return { orgId: org.id, userId: user.id };
}

// Read-only: what does this database actually look like right now?
export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.res;

  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  const columnsOf = (t: string) =>
    db.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
      t
    );

  let migrations: unknown[] = [];
  try {
    migrations = await db.$queryRawUnsafe(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at`
    );
  } catch {
    migrations = [{ error: "_prisma_migrations table not present" }];
  }

  const target = await resolveTarget().catch((e) => ({ error: String(e) }));

  return NextResponse.json({
    target,
    tables: tables.map((t) => t.table_name),
    campaignColumns: (await columnsOf("Campaign")).map((c) => c.column_name),
    postColumns: (await columnsOf("Post")).map((c) => c.column_name),
    hasCcTables: tables.some((t) => t.table_name === "CcCampaign"),
    migrations,
    counts: {
      organization: await db.organization.count(),
      campaign: await db.campaign.count(),
      post: await db.post.count(),
      creator: await db.creator.count(),
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.res;

  const body = (await request.json()) as { action?: string; table?: string; rows?: Record<string, unknown>[] };
  const action = body.action;

  try {
    if (action === "migrate") {
      const applied: string[] = [];
      for (const stmt of [...PARITY_DDL, ...DRIFT_REPAIR_DDL]) {
        await db.$executeRawUnsafe(stmt);
        applied.push(stmt.slice(0, 72).replace(/\s+/g, " "));
      }
      return NextResponse.json({ ok: true, statements: applied.length, applied });
    }

    if (action === "columns") {
      // Every column of every table, so a P2022 ColumnNotFound can be diffed
      // against the Prisma schema without guessing which model drifted.
      const rows = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' ORDER BY table_name, column_name`
      );
      const byTable: Record<string, string[]> = {};
      for (const r of rows) (byTable[r.table_name] ??= []).push(r.column_name);
      return NextResponse.json({ ok: true, byTable });
    }

    if (action === "have") {
      // Keys already present, so the driver can resume instead of re-sending.
      const { orgId } = await resolveTarget();
      const t = body.table ?? "";
      if (t === "campaign") {
        const rows = await db.campaign.findMany({
          where: { orgId, ccCampaignId: { not: null } },
          select: { id: true, ccCampaignId: true },
        });
        return NextResponse.json({ ok: true, rows });
      }
      if (t === "post") {
        const rows = await db.post.findMany({
          where: { ccPostId: { not: null }, campaign: { orgId } },
          select: { ccPostId: true },
        });
        return NextResponse.json({ ok: true, keys: rows.map((r) => r.ccPostId) });
      }
      if (t === "creator") {
        const rows = await db.creator.findMany({ where: { orgId }, select: { id: true, handle: true, platform: true } });
        return NextResponse.json({ ok: true, rows });
      }
      if (t in LOADABLE) {
        const rows = await (db as never as Record<string, { findMany: (a: unknown) => Promise<{ ccId: string }[]> }>)[
          LOADABLE[t].delegate
        ].findMany({ where: { orgId }, select: { ccId: true } });
        return NextResponse.json({ ok: true, keys: rows.map((r) => r.ccId) });
      }
      return NextResponse.json({ error: `unknown table ${t}` }, { status: 400 });
    }

    if (action === "load") {
      const spec = LOADABLE[body.table ?? ""];
      if (!spec) return NextResponse.json({ error: `table not loadable: ${body.table}` }, { status: 400 });
      const rows = body.rows ?? [];
      if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

      const { orgId, userId } = await resolveTarget();
      const data = rows.map((r) => {
        if (spec.inject === "org") return { ...r, orgId };
        if (spec.inject === "orgAndCreator") return { ...r, orgId, createdById: userId };
        return r;
      });

      const delegate = (db as never as Record<string, { createMany: (a: unknown) => Promise<{ count: number }> }>)[
        spec.delegate
      ];
      const res = await delegate.createMany({ data, skipDuplicates: true });
      return NextResponse.json({ ok: true, inserted: res.count, sent: rows.length });
    }

    if (action === "counts") {
      const { orgId } = await resolveTarget();
      const byStatus = await db.campaign.groupBy({
        by: ["status"],
        where: { orgId, ccCampaignId: { not: null } },
        _count: true,
      });
      const byFetch = await db.post.groupBy({
        by: ["fetchState"],
        where: { ccPostId: { not: null }, campaign: { orgId } },
        _count: true,
      });
      const byPlatform = await db.post.groupBy({
        by: ["platform"],
        where: { ccPostId: { not: null }, campaign: { orgId } },
        _count: true,
      });
      const views = await db.post.aggregate({
        where: { ccPostId: { not: null }, campaign: { orgId } },
        _sum: { viewsCount: true },
      });
      return NextResponse.json({
        ok: true,
        orgId,
        mirror: {
          ccCampaign: await db.ccCampaign.count({ where: { orgId } }),
          ccPost: await db.ccPost.count({ where: { orgId } }),
          ccRefreshQueue: await db.ccRefreshQueue.count({ where: { orgId } }),
        },
        domain: {
          campaignsImported: await db.campaign.count({ where: { orgId, ccCampaignId: { not: null } } }),
          campaignsTotal: await db.campaign.count({ where: { orgId } }),
          postsImported: await db.post.count({ where: { ccPostId: { not: null }, campaign: { orgId } } }),
          postsTotal: await db.post.count({ where: { campaign: { orgId } } }),
          creators: await db.creator.count({ where: { orgId } }),
          totalViews: views._sum.viewsCount ?? 0,
        },
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
        byFetchState: Object.fromEntries(byFetch.map((r) => [r.fetchState ?? "null", r._count])),
        byPlatform: Object.fromEntries(byPlatform.map((r) => [r.platform, r._count])),
      });
    }

    return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
