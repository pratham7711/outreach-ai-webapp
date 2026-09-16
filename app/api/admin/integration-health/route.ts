import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { db } from "@/lib/db";
import {
  checkInstagramBusinessSource,
  checkInstagramEmbedFallback,
  type InstagramFallbackHealth,
} from "@/lib/integrations/health";

/**
 * Is the platform's Instagram data source alive? Read by the banners on the
 * surfaces where Instagram numbers are consumed.
 *
 * The Instagram probe is deliberately NOT orgId-filtered, unlike every other
 * read in this codebase: INSTAGRAM_BUSINESS_TOKEN is one deployment-wide env var
 * serving every tenant, so there is no per-tenant row there to scope.
 * Authentication is still required -- the answer says something about our
 * infrastructure, and an anonymous caller has no business learning it -- but any
 * signed-in member gets the same answer, because the banner has to render for
 * the people who read the numbers, not only for the admin who can fix it.
 *
 * The fallback probe is the exception and IS org-scoped, because it needs a post
 * to ask Instagram about and a post is tenant data. It picks one of the caller's
 * own, never another org's.
 *
 * Both probes are cached for 5 minutes across the deployment, so this route is
 * cheap to poll and cannot be used to hammer either surface.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const instagram = await checkInstagramBusinessSource();

  /* Only when the official source is already down. While it works, what the
     credential-free fallback is doing changes nothing anyone would read: the
     numbers are arriving. This keeps the outbound request off the healthy
     path, which is almost every request. */
  let instagramFallback: InstagramFallbackHealth | null = null;
  if (!instagram.ok) {
    const sample = await db.post.findFirst({
      /* Posts carry no orgId of their own; the tenant is the campaign's, which
         is how every other post read in this codebase scopes itself. */
      where: { campaign: { orgId: auth.orgId, deletedAt: null }, platform: "INSTAGRAM", postUrl: { not: "" } },
      orderBy: { createdAt: "desc" },
      select: { postUrl: true },
    });
    if (sample?.postUrl) {
      /* A probe that throws must not take the banner down with it: the
         Business Discovery answer above is the more important half. */
      instagramFallback = await checkInstagramEmbedFallback(sample.postUrl).catch(() => null);
    }
  }

  return NextResponse.json({ instagram, instagramFallback });
}
