import { NextRequest, NextResponse } from "next/server";
import { fetchMarketplaceList, type SortKey } from "@/lib/marketplace/public";

/**
 * GET /api/public/marketplace — UNAUTHENTICATED, cross-org list of GLOBAL
 * marketplace campaigns (Whop Content-Rewards style). NEVER calls auth();
 * delegates to fetchMarketplaceList which selects only the strict public
 * whitelist (see MARKETPLACE_LIST_SELECT in lib/marketplace/public.ts).
 *
 * Query params:
 *   q         — free-text search over title + org name
 *   platform  — TIKTOK|INSTAGRAM|YOUTUBE|TWITTER (campaigns with a rate for it)
 *   type      — CampaignType filter
 *   sort      — newest (default) | rate | budget
 *   page      — 1-based (default 1)
 *   pageSize  — default 12, max 48
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const result = await fetchMarketplaceList({
      q: sp.get("q") ?? undefined,
      platform: sp.get("platform") ?? undefined,
      type: sp.get("type") ?? undefined,
      sort: (sp.get("sort") as SortKey) ?? undefined,
      page: parseInt(sp.get("page") ?? "1", 10) || 1,
      pageSize: parseInt(sp.get("pageSize") ?? "12", 10) || 12,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[public/marketplace] list failed:", error);
    return NextResponse.json({ error: "Failed to load marketplace" }, { status: 500 });
  }
}
