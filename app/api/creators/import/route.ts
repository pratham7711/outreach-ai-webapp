import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { applyImport, planImport } from "@/lib/creators/importCreators";
import {
  IMPORT_FIELDS,
  MAX_COMMIT_CHUNK,
  MAX_IMPORT_PEOPLE,
  MAX_IMPORT_ROWS,
  parseSheet,
  primaryLink,
  type ImportPerson,
} from "@/lib/creators/importParse";
import { LEGACY_CELL_RULES } from "@/lib/creators/importParseLegacy";

export const maxDuration = 60;

const cell = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);

const importSchema = z.object({
  /** The sheet as read: header row first, then one array per answer. */
  rows: z.array(z.array(cell).max(80)).min(1).max(MAX_IMPORT_ROWS + 1),
  mapping: z.array(z.enum(IMPORT_FIELDS).nullable()).max(80).optional(),
  extraTags: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  source: z.string().trim().max(120).optional(),
  mode: z.enum(["dryRun", "commit"]),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(MAX_COMMIT_CHUNK).default(200),
});

// POST /api/creators/import
export async function POST(request: NextRequest) {
  const gate = await requirePermission(request, "creators:create");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;

  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid import", details: parsed.error.flatten() }, { status: 400 });
  }
  const { rows, mapping, extraTags, mode, offset, limit } = parsed.data;
  const source = parsed.data.source || "Import";

  if (!(await rosterTablesReady())) {
    return NextResponse.json(
      { error: "Importing isn't set up yet. An admin needs to run the roster migration first." },
      { status: 503 },
    );
  }

  const sheet = parseSheet(rows, mapping);
  // The same rows as the first import's parser read them, so a value it
  // misread and nobody has touched since can be told from one that was typed.
  // Rows group into the same people either way: grouping is by account and
  // email, which neither parser reads differently.
  const firstReading = new Map(parseSheet(rows, mapping, LEGACY_CELL_RULES).people.map((p) => [p.rows.join(","), p]));
  const earlier = (people: ImportPerson[]) => people.map((p) => firstReading.get(p.rows.join(",")));
  if (sheet.people.length > MAX_IMPORT_PEOPLE) {
    return NextResponse.json(
      { error: `This sheet has ${sheet.people.length} creators; import at most ${MAX_IMPORT_PEOPLE} at a time.` },
      { status: 413 },
    );
  }

  if (mode === "dryRun") {
    const plan = await planImport(orgId, sheet.people, extraTags, earlier(sheet.people));
    const count = (a: string) => plan.people.filter((p) => p.action === a).length;
    return NextResponse.json({
      counts: {
        totalRows: sheet.totalRows,
        people: sheet.people.length,
        create: count("create"),
        update: count("update"),
        correct: count("correct"),
        unchanged: count("unchanged"),
        rejected: sheet.rejected.length,
        merged: sheet.mergedRows,
      },
      newTags: plan.newTags,
      people: plan.people.map((p, index) => ({
        index,
        name: p.rosterName ?? p.person.name,
        sheetName: p.person.name,
        rows: p.person.rows,
        primary: primaryLink(p.person.links),
        links: p.person.links,
        rate: p.person.rate,
        audienceCountry: p.person.audienceCountry,
        tags: [...new Set([...p.person.tags, ...extraTags])],
        action: p.action,
        changes: p.changes,
        corrections: p.corrections,
        creatorId: p.creatorId,
      })),
      rejected: sheet.rejected,
    });
  }

  // Re-planned here rather than trusting the preview: the commit writes what
  // the database says now, which is what makes a retried chunk a no-op.
  const slice = sheet.people.slice(offset, offset + limit);
  const plan = await planImport(orgId, slice, extraTags, earlier(slice));
  const result = await applyImport(orgId, plan, source);
  const nextOffset = Math.min(offset + limit, sheet.people.length);

  if (result.created || result.updated || result.corrected) {
    await logAudit({
      orgId,
      ...getAuditActor(gate.auth),
      action: "creators.import",
      entityType: "creator",
      entityLabel: source,
      ipAddress: getRequestIp(request),
      metadata: {
        source,
        offset,
        people: slice.length,
        created: result.created,
        updated: result.updated,
        corrected: result.corrected,
        unchanged: result.unchanged,
      },
      after: { creatorIds: result.creatorIds },
    });
  }

  return NextResponse.json({
    created: result.created,
    updated: result.updated,
    corrected: result.corrected,
    unchanged: result.unchanged,
    total: sheet.people.length,
    nextOffset,
    done: nextOffset >= sheet.people.length,
  });
}
