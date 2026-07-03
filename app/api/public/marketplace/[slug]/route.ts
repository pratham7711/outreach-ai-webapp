import { NextRequest, NextResponse } from "next/server";
import { fetchMarketplaceDetail } from "@/lib/marketplace/public";

/**
 * GET /api/public/marketplace/[slug] — UNAUTHENTICATED single campaign detail.
 * PRIVATE and INVITE_ONLY campaigns 404 (INVITE_ONLY joins by code, not browse).
 * NEVER calls auth(); delegates to fetchMarketplaceDetail which selects only
 * MARKETPLACE_DETAIL_SELECT.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const result = await fetchMarketplaceDetail(slug);
    if (!result) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[public/marketplace/:slug] failed:", error);
    return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
  }
}
