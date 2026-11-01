import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCreatorFinder, noStore } from "@/lib/creatorFinder/gate";
import { permissionDenial } from "@/lib/authz";
import { isMissingProspectTable } from "@/lib/creatorFinder/prospectDdl";
import { parseProspectInput, type ProspectPlatform, PROSPECT_SOURCES, type ProspectSource } from "@/lib/creatorFinder/prospects";
import { portalSignups, rosterMatches } from "@/lib/creatorFinder/roster";
import { createLogger } from "@/lib/observability/logger";
import { scoutAiState } from "@/lib/creatorFinder/scoutAi";

export const dynamic = "force-dynamic";

const log = createLogger({ context: { call: "creatorFinder.list" } });

const notReady = () =>
  NextResponse.json(
    { error: "not_set_up", reason: "Creator Finder's tables aren't on this database yet." },
    { status: 503, headers: noStore },
  );

/**
 * GET /api/creator-finder -- the board. A prospect who has since landed on the
 * roster (through a campaign invite, the portal or the add form) moves to
 * Joined here, with an event, so the board needs no manual tidy-up. A portal
 * sign-up counts on any platform, since the portal doesn't ask for one.
 */
export async function GET(req: NextRequest) {
  const auth = await requireCreatorFinder(req);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = auth;
  try {
    const prospects = await db.creatorProspect.findMany({
      where: { orgId },
      orderBy: [{ statusChangedAt: "desc" }],
      take: 1000,
      include: { events: { orderBy: { at: "desc" }, take: 6, select: { fromStatus: true, toStatus: true, at: true, userId: true } } },
    });

    const open = prospects.filter((p) => p.status !== "JOINED" && p.status !== "DISMISSED");
    const joined: string[] = [];
    for (const platform of ["INSTAGRAM", "YOUTUBE"] as const) {
      const mine = open.filter((p) => p.platform === platform);
      if (!mine.length) continue;
      const onRoster = await rosterMatches(orgId, platform, mine.map((p) => p.handle));
      for (const p of mine) if (onRoster.has(p.handle)) joined.push(p.id);
    }
    const waiting = open.filter((p) => !joined.includes(p.id));
    if (waiting.length) {
      const since = new Date(Math.min(...waiting.map((p) => p.createdAt.getTime())));
      const signedUp = await portalSignups(orgId, waiting.map((p) => p.handle), since);
      for (const p of waiting) {
        const at = signedUp.get(p.handle);
        if (at && at >= p.createdAt) joined.push(p.id);
      }
    }
    if (joined.length) {
      const now = new Date();
      await db.$transaction([
        db.creatorProspect.updateMany({
          where: { orgId, id: { in: joined }, status: { notIn: ["JOINED", "DISMISSED"] } },
          data: { status: "JOINED", statusChangedAt: now },
        }),
        db.creatorProspectEvent.createMany({
          data: prospects
            .filter((p) => joined.includes(p.id))
            .map((p) => ({ prospectId: p.id, orgId, fromStatus: p.status, toStatus: "JOINED", userId: null, at: now })),
        }),
      ]);
      for (const p of prospects) if (joined.includes(p.id)) Object.assign(p, { status: "JOINED", statusChangedAt: now });
    }

    const ai = await scoutAiState(orgId);
    return NextResponse.json({ prospects, ai }, { headers: noStore });
  } catch (e) {
    if (isMissingProspectTable(e)) return notReady();
    log.error("Failed to load the Creator Finder board", { message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Failed to load" }, { status: 500, headers: noStore });
  }
}

/**
 * POST /api/creator-finder -- add handles to Found. Accepts a paste (`text`,
 * with `platform` for bare handles) or a single pick from YouTube search
 * (`handle`/`channelId`). Handles already on the roster or the board are
 * reported back, not added twice.
 */
export async function POST(req: NextRequest) {
  const auth = await requireCreatorFinder(req);
  if (auth instanceof NextResponse) return auth;
  /* Viewers read the board; moving or adding a card needs the same permission as adding a creator. */
  const denied = permissionDenial(auth, "creators:create");
  if (denied) return denied;
  const { orgId, userId } = auth;

  const body = (await req.json().catch(() => null)) as {
    text?: unknown;
    platform?: unknown;
    source?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const platform: ProspectPlatform = body?.platform === "YOUTUBE" ? "YOUTUBE" : "INSTAGRAM";
  const source: ProspectSource =
    typeof body?.source === "string" && (PROSPECT_SOURCES as readonly string[]).includes(body.source)
      ? (body.source as ProspectSource)
      : "PASTE";
  if (!text.trim()) return NextResponse.json({ error: "Paste at least one handle or profile link." }, { status: 400, headers: noStore });

  const { items, skipped, overLimit } = parseProspectInput(text, platform);
  try {
    const onRoster: string[] = [];
    const fresh: typeof items = [];
    for (const p of ["INSTAGRAM", "YOUTUBE"] as const) {
      const mine = items.filter((i) => i.platform === p);
      if (!mine.length) continue;
      const matches = await rosterMatches(orgId, p, mine.map((i) => i.handle));
      for (const i of mine) {
        if (matches.has(i.handle)) onRoster.push(`@${i.handle}`);
        else fresh.push(i);
      }
    }

    const existing = fresh.length
      ? await db.creatorProspect.findMany({
          where: { orgId, OR: fresh.map((i) => ({ platform: i.platform, handle: i.handle })) },
          select: { platform: true, handle: true },
        })
      : [];
    const listed = new Set(existing.map((e) => `${e.platform}:${e.handle}`));
    const toAdd = fresh.filter((i) => !listed.has(`${i.platform}:${i.handle}`));

    const created = toAdd.length
      ? await db.creatorProspect.createManyAndReturn({
          data: toAdd.map((i) => ({
            orgId,
            platform: i.platform,
            handle: i.handle,
            channelId: i.channelId,
            source,
            createdById: userId,
          })),
          skipDuplicates: true,
          select: { id: true },
        })
      : [];
    if (created.length) {
      await db.creatorProspectEvent.createMany({
        data: created.map((c) => ({ prospectId: c.id, orgId, fromStatus: null, toStatus: "FOUND", userId })),
      });
    }

    return NextResponse.json(
      {
        added: created.length,
        alreadyOnBoard: fresh.filter((i) => listed.has(`${i.platform}:${i.handle}`)).map((i) => `@${i.handle}`),
        onRoster,
        skipped,
        overLimit,
      },
      { headers: noStore },
    );
  } catch (e) {
    if (isMissingProspectTable(e)) return notReady();
    log.error("Failed to add prospects", { message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Failed to add" }, { status: 500, headers: noStore });
  }
}
