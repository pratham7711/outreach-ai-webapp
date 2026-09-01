import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { z } from "zod";
import { dateParam, pageParam, pageSizeParam, parseQuery } from "@/lib/http/queryParams";

/**
 * GET /api/email-logs — what this org's mail actually did.
 *
 * Deliberately not folded into /api/audit-logs. That endpoint is gated on the
 * audit_log entitlement, and delivery history is not a paid feature: an org
 * whose plan has the audit log switched off still has to be able to answer
 * "did the invitation reach them", which is a support question, not an
 * enterprise one.
 *
 * users:manage rather than a plain session check, because the rows carry the
 * addresses this org has mailed.
 */
const querySchema = z.object({
  page: pageParam,
  pageSize: pageSizeParam(),
  kind: z.string().trim().optional(),
  status: z.enum(["sent", "failed", "not_configured"]).optional(),
  q: z.string().trim().optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
});

export async function GET(req: NextRequest) {
  const gate = await requirePermission(req, "users:manage");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;

  const parsed = parseQuery(querySchema, new URL(req.url).searchParams);
  if (!parsed.ok) return parsed.response;
  const { page, pageSize, kind, status, q, from, to } = parsed.data;

  /* orgId is pinned from the session and never widened. Platform mail with a
     null orgId (ops alerts) is nobody's tenant history and stays out of every
     org's view -- `orgId: <id>` already excludes null, but it is worth saying
     out loud since the column is nullable. */
  const where: any = {
    orgId,
    ...(kind && { kind }),
    ...(status && { status }),
    ...(q && {
      OR: [
        { recipients: { has: q } },
        { subject: { contains: q, mode: "insensitive" } },
        { actorEmail: { contains: q, mode: "insensitive" } },
      ],
    }),
    ...((from || to) && {
      createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) },
    }),
  };

  const [logs, total] = await Promise.all([
    db.emailLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        kind: true,
        recipients: true,
        subject: true,
        status: true,
        providerId: true,
        error: true,
        actorEmail: true,
        entityId: true,
        createdAt: true,
      },
    }),
    db.emailLog.count({ where }),
  ]);

  return NextResponse.json({
    logs: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}
