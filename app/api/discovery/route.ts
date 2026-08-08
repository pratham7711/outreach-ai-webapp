import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { DISCOVERY_FEATURE } from "@/lib/featureKeys";

const MAX_PAGE_SIZE = 100;

const discoveryQuerySchema = z.object({
  search: z.string().default(""),
  platform: z.string().optional(),
  sort: z.enum(["followers", "engagement", "name"]).default("followers"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  niches: z.string().default(""),
  minFollowers: z.coerce.number().int().nonnegative().optional(),
  maxFollowers: z.coerce.number().int().nonnegative().optional(),
  minRate: z.coerce.number().nonnegative().optional(),
  maxRate: z.coerce.number().nonnegative().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;

  const entitlements = await getOrgEntitlements(orgId);
  if (!hasOrgFeature(entitlements, DISCOVERY_FEATURE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rawQuery = Object.fromEntries(
    [...req.nextUrl.searchParams.entries()].filter(([, value]) => value !== ""),
  );
  const parsed = discoveryQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const {
    search,
    platform,
    sort,
    page,
    limit,
    minFollowers,
    maxFollowers,
    minRate,
    maxRate,
  } = parsed.data;
  const niches = parsed.data.niches.split(",").filter(Boolean);

  const where: any = { orgId, deletedAt: null };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { handle: { contains: search, mode: "insensitive" } },
    ];
  }
  if (platform && platform !== "All") {
    where.platform = platform.toUpperCase();
  }

  if (niches.length > 0) where.niches = { hasSome: niches };

  if (minFollowers !== undefined || maxFollowers !== undefined) {
    where.followersCount = {};
    if (minFollowers !== undefined) (where.followersCount as any).gte = minFollowers;
    if (maxFollowers !== undefined) (where.followersCount as any).lte = maxFollowers;
  }

  if (minRate !== undefined || maxRate !== undefined) {
    where.rate = {};
    if (minRate !== undefined) (where.rate as any).gte = minRate;
    if (maxRate !== undefined) (where.rate as any).lte = maxRate;
  }

  const orderBy: any = sort === "engagement" ? { averageViews: "desc" } :
    sort === "name" ? { name: "asc" } : { followersCount: "desc" };

  const [creators, total] = await Promise.all([
    db.creator.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { activations: true, posts: true } },
      },
    }),
    db.creator.count({ where }),
  ]);

  return NextResponse.json({
    creators,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
