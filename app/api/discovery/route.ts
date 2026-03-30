import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { DISCOVERY_FEATURE } from "@/lib/featureKeys";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;

  const entitlements = await getOrgEntitlements(orgId);
  if (!hasOrgFeature(entitlements, DISCOVERY_FEATURE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;

  const search = searchParams.get("search") ?? "";
  const platform = searchParams.get("platform");
  const sort = searchParams.get("sort") ?? "followers";
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");

  const where: any = { orgId, deletedAt: null };

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { handle: { contains: search } },
    ];
  }
  if (platform && platform !== "All") {
    where.platform = platform.toUpperCase();
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
