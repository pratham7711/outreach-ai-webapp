import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { z } from "zod";
import { db } from "@/lib/db";
import { stripAt } from "@/lib/format";
import { auditRoster } from "@/lib/creators/rosterAudit";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { planImport, type PlanAction } from "@/lib/creators/importCreators";
import {
  IMPORT_FIELDS,
  MAX_IMPORT_PEOPLE,
  MAX_IMPORT_ROWS,
  parseSheet,
  primaryLink,
  type ImportPerson,
} from "@/lib/creators/importParse";
import { LEGACY_CELL_RULES } from "@/lib/creators/importParseLegacy";
import { resolvePostLinks } from "@/lib/creators/resolvePostLinks";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Checks one org's roster on production, where nobody signs in as the client.
 * Same ADMIN_MIGRATE_TOKEN gate as the migrate-* routes.
 *
 *   GET                 orgs and their creator counts
 *   GET ?org=<id>       read-only roster audit (handles only, no names or emails)
 *   POST                what re-importing a sheet would correct, fill or add
 *
 * Nothing here writes. The planner is the one behind Roster → Import, so the
 * dry run is what the client would see on re-uploading the sheet; applying it
 * stays with them, signed in, on that screen.
 */

function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

const cell = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);

const bodySchema = z.object({
  orgId: z.string().min(1),
  rows: z.array(z.array(cell).max(80)).min(1).max(MAX_IMPORT_ROWS + 1),
  mapping: z.array(z.enum(IMPORT_FIELDS).nullable()).max(80).optional(),
  extraTags: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
});

const SAMPLE = 40;

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}


export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const orgId = request.nextUrl.searchParams.get("org");
    if (!orgId) {
      const orgs = await db.organization.findMany({
        select: { id: true, name: true, _count: { select: { creators: true } } },
        orderBy: { name: "asc" },
      });
      return NextResponse.json({
        ok: true,
        orgs: orgs.map((o) => ({ id: o.id, name: o.name, creators: o._count.creators })),
      });
    }
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) return NextResponse.json({ error: "No such org" }, { status: 404 });
    return NextResponse.json({ ok: true, org, ...(await auditRoster(org.id)) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { orgId, rows, mapping, extraTags } = parsed.data;

  try {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) return NextResponse.json({ error: "No such org" }, { status: 404 });
    if (!(await rosterTablesReady())) {
      return NextResponse.json({ error: "Roster tables are missing; run migrate-creator-roster first." }, { status: 503 });
    }

    const post = await resolvePostLinks(rows, mapping);
    const sheet = parseSheet(post.rows, mapping);
    if (sheet.people.length > MAX_IMPORT_PEOPLE) {
      return NextResponse.json({ error: `The sheet has ${sheet.people.length} people; at most ${MAX_IMPORT_PEOPLE}.` }, { status: 413 });
    }
    const firstReading = new Map(parseSheet(post.rows, mapping, LEGACY_CELL_RULES).people.map((p) => [p.rows.join(","), p]));
    const earlier = (people: ImportPerson[]) => people.map((p) => firstReading.get(p.rows.join(",")));
    const who = (p: ImportPerson) => {
      const l = primaryLink(p.links);
      return l ? `${l.platform.toLowerCase()} @${stripAt(l.handle)}` : `row ${p.rows[0]}`;
    };

    const plan = await planImport(org.id, sheet.people, extraTags, earlier(sheet.people));
    const of = (a: PlanAction) => plan.people.filter((p) => p.action === a);
    const corrections = of("correct").flatMap((p) => p.corrections.map((c) => `${who(p.person)}: ${c}`));
    return NextResponse.json({
      ok: true,
      org,
      counts: {
        totalRows: sheet.totalRows,
        people: sheet.people.length,
        create: of("create").length,
        update: of("update").length,
        correct: of("correct").length,
        unchanged: of("unchanged").length,
        rejected: sheet.rejected.length,
        merged: sheet.mergedRows,
        resolvedFromPosts: post.resolved.length,
      },
      resolved: post.resolved.map((r) => `row ${r.row}: ${r.platform.toLowerCase()} @${r.handle}`),
      corrections: { values: corrections.length, sample: corrections.slice(0, SAMPLE) },
      updates: {
        byChange: tally(of("update").flatMap((p) => p.changes)),
        sample: of("update").slice(0, SAMPLE).map((p) => `${who(p.person)}: ${p.changes.join(", ")}`),
      },
      creates: { sample: of("create").slice(0, SAMPLE).map((p) => who(p.person)) },
      newTags: plan.newTags,
      rejected: {
        byReason: tally(sheet.rejected.map((r) => r.reason)),
        rows: sheet.rejected.map((r) => r.row),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
