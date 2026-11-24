import { NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { metaDemoMocked, metaReviewScopesOn } from "@/lib/oauth/metaReviewScopes";

export const dynamic = "force-dynamic";

/** GET /api/portal/instagram/features — whether the comment and Partnership
    Ads tools are switched on (their permissions are requested only while
    META_REVIEW_SCOPES=1). */
export async function GET() {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const on = metaReviewScopesOn() || metaDemoMocked();
  return NextResponse.json({ comments: on, partnerAds: on }, { headers: { "Cache-Control": "no-store" } });
}
