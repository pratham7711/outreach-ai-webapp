import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import { pageParam, pageSizeParam, parseQuery } from "@/lib/http/queryParams";
import { creatorFilterSchema, creatorOrderBy, creatorWhere } from "@/lib/listFilters";
import { creatorHandleVariants } from "@/lib/creator-auth";
import { DEFAULT_CREATOR_SORT } from "@/lib/listParams";

const listCreatorsQuerySchema = creatorFilterSchema.extend({
  page: pageParam,
  limit: pageSizeParam(20, 200),
});

const createCreatorSchema = z.object({
  name: z.string().min(1).max(200),
  handle: z.string().min(1).max(100),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
  contactEmail: z.string().email().optional(),
  bio: z.string().optional(),
  rate: z.number().positive().optional(),
  followersCount: z.number().int().nonnegative().optional(),
  averageViews: z.number().int().nonnegative().optional(),
});

// GET /api/creators
export async function GET(request: NextRequest) {
  try {
    const result = await authenticateRequest(request);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const parsedQuery = parseQuery(listCreatorsQuerySchema, request.nextUrl.searchParams);
    if (!parsedQuery.ok) return parsedQuery.response;
    const { page, limit, ...filters } = parsedQuery.data;
    const skip = (page - 1) * limit;

    const where = creatorWhere(orgId, filters);

    const [creators, total] = await Promise.all([
      db.creator.findMany({
        where,
        // Same order as the page, tiebreaker included. 1,834 creators share
        // only 1,825 distinct addedAt values, so without a unique second key a
        // tie straddling a page boundary can hand back one creator twice and
        // another never.
        orderBy: creatorOrderBy(DEFAULT_CREATOR_SORT),
        skip,
        take: limit,
      }),
      db.creator.count({ where }),
    ]);

    return NextResponse.json({
      creators,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to fetch creators:", error);
    return NextResponse.json(
      { error: "Failed to fetch creators" },
      { status: 500 }
    );
  }
}

// POST /api/creators
export async function POST(request: NextRequest) {
  try {
    /* creators:create is the key rbac.ts already reserves for this: MEMBER and
       above have it, VIEWER does not. The GET above stays open to every member. */
    const gate = await requirePermission(request, "creators:create");
    if (!gate.ok) return gate.response;
    const result = gate.auth;
    const { orgId } = result;

    const body = await request.json();
    const parsed = createCreatorSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, handle, platform, contactEmail, bio, rate, followersCount, averageViews } = parsed.data;

    // A handle is how a creator is identified everywhere else in this app: the
    // portal matches its CreatorUser to an org Creator by handle, and so does
    // the proposal-accept path. Both of those find-before-create; this route
    // did not, so typing a handle that already existed silently produced a
    // second row and left the two paths disagreeing about which one is real.
    //
    // Not a database constraint, deliberately: 23 handles imported from
    // CreatorCore are already duplicated, and de-duplicating rows we did not
    // create is not this route's decision to make. The guard covers everything
    // created from here on.
    /* Matched on both spellings and case-insensitively, not on the exact
       string. Storage is unchanged -- whatever was typed is what is written --
       but "@jane" and "jane" are one creator to everything downstream:
       creatorHandleVariants() is how the portal bridges a CreatorUser to an org
       Creator, and how the proposal-accept path does it too. An exact match let
       both rows exist, and then those two paths disagreed about which is real. */
    const clash = await db.creator.findFirst({
      where: {
        orgId,
        deletedAt: null,
        OR: creatorHandleVariants(handle).map((h) => ({
          handle: { equals: h, mode: "insensitive" as const },
        })),
      },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json(
        { error: `A creator with the handle ${handle} already exists`, creatorId: clash.id },
        { status: 409 }
      );
    }

    const creator = await db.creator.create({
      data: {
        name,
        handle,
        platform: platform ?? "TIKTOK",
        contactEmail: contactEmail ?? null,
        bio: bio ?? null,
        rate: rate ?? null,
        followersCount: followersCount ?? 0,
        averageViews: averageViews ?? 0,
        orgId,
      },
    });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "creator.create",
      entityType: "creator",
      entityId: creator.id,
      entityLabel: creator.name,
      ipAddress: getRequestIp(request),
      after: {
        id: creator.id,
        name: creator.name,
        handle: creator.handle,
        platform: creator.platform,
      },
    });

    return NextResponse.json(creator, { status: 201 });
  } catch (error) {
    console.error("Failed to create creator:", error);
    return NextResponse.json(
      { error: "Failed to create creator" },
      { status: 500 }
    );
  }
}
