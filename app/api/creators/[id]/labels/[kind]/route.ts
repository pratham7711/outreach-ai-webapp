import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * Which of the org's tags and flags are on a creator.
 *
 * The reference puts both on the creator's own profile -- a Tags section that
 * reads "No tags added yet!" when empty, and a Flag Creator action -- and uses
 * the tags again as include/exclude filters on the creators list. The
 * definitions live in Settings → General; this is only the membership.
 *
 * PUT replaces the whole set rather than offering add and remove endpoints.
 * The UI knows the full selection either way, and a set is idempotent: the same
 * request twice leaves the same three tags on the creator instead of throwing on
 * a duplicate or silently adding a fourth.
 */

const KINDS = {
  tags: {
    defs: () => db.creatorTagDef,
    links: () => db.creatorTagLink,
    column: "tagId" as const,
    auditType: "creator_tag_link",
  },
  flags: {
    defs: () => db.creatorFlagDef,
    links: () => db.creatorFlagLink,
    column: "flagId" as const,
    auditType: "creator_flag_link",
  },
};

type Kind = keyof typeof KINDS;
const isKind = (v: string): v is Kind => Object.prototype.hasOwnProperty.call(KINDS, v);

const bodySchema = z.object({ ids: z.array(z.string()).max(50) });

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const { id, kind } = await params;
  if (!isKind(kind)) return NextResponse.json({ error: "Unknown label kind" }, { status: 404 });
  const spec = KINDS[kind];

  const creator = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected a list of ids" }, { status: 400 });

  const ids = [...new Set(parsed.data.ids)];

  // The ids arrive in the body, so each one has to be proven to belong to this
  // org before it is linked -- otherwise a caller could tag their creator with
  // another org's definition and read its name back out.
  if (ids.length) {
    const owned = await (spec.defs() as { findMany: (a: unknown) => Promise<{ id: string }[]> }).findMany({
      where: { id: { in: ids }, orgId },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      return NextResponse.json({ error: "Unknown label for this organisation" }, { status: 400 });
    }
  }

  const links = spec.links() as {
    findMany: (a: unknown) => Promise<Record<string, string>[]>;
    deleteMany: (a: unknown) => Promise<unknown>;
    createMany: (a: unknown) => Promise<unknown>;
  };

  const before = (await links.findMany({ where: { creatorId: id }, select: { [spec.column]: true } }))
    .map((r) => r[spec.column]);

  await db.$transaction([
    links.deleteMany({ where: { creatorId: id } }) as never,
    ...(ids.length
      ? [links.createMany({ data: ids.map((v) => ({ creatorId: id, [spec.column]: v })) }) as never]
      : []),
  ]);

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: `${spec.auditType}.set`,
    entityType: "creator",
    entityId: creator.id,
    entityLabel: creator.name,
    ipAddress: getRequestIp(request),
    before: { [kind]: before },
    after: { [kind]: ids },
  });

  return NextResponse.json({ ids });
}
