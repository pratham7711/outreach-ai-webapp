import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import { pageParam, pageSizeParam, parseQuery } from "@/lib/http/queryParams";

const listCreatorsQuerySchema = z.object({
  search: z.string().optional(),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
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
    const { search, platform, page, limit } = parsedQuery.data;
    const skip = (page - 1) * limit;

    const where = {
      orgId,
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { handle: { contains: search, mode: "insensitive" as const } },
        ],
      }),
      ...(platform && { platform: platform as "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "TWITTER" }),
      deletedAt: null,
    };

    const [creators, total] = await Promise.all([
      db.creator.findMany({
        where,
        orderBy: { addedAt: "desc" },
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
    const result = await authenticateRequest(request);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
