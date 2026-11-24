import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCreatorSession } from "@/lib/creator-auth";
import {
  AD_AUTH_DAYS,
  deleteAdAuthorization,
  enableAdAuthorization,
  extendAdAuthorization,
  fetchAdAuthorization,
  type AdAuthDays,
} from "@/lib/platforms/tiktokBusiness";
import { tiktokBusinessAccess } from "@/lib/portal/tiktokBusinessConnection";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/observability/logger";
import { noStore, refusal, tiktokFailure } from "../shared";

export const dynamic = "force-dynamic";

const log = createLogger({ context: { platform: "TIKTOK", call: "business.adCode" } });
const ITEM = z.string().regex(/^\d{5,32}$/);
const DAYS = z.number().refine((d): d is AdAuthDays => (AD_AUTH_DAYS as readonly number[]).includes(d)).transform((d) => d as AdAuthDays);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), item: ITEM, days: DAYS }),
  z.object({ action: z.literal("extend"), item: ITEM, days: DAYS }),
  z.object({ action: z.literal("delete"), item: ITEM }),
]);

/**
 * The ad authorization (Spark Ads) code of one of the creator's own posts.
 * GET ?item= reads it. POST turns it on for a period, extends it, or deletes
 * it -- each only ever at the creator's own click on their own post.
 */
export async function GET(req: NextRequest) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const item = ITEM.safeParse(req.nextUrl.searchParams.get("item"));
  if (!item.success) return NextResponse.json({ error: "bad_item" }, { status: 400, headers: noStore });
  const access = await tiktokBusinessAccess(session.creatorUserId);
  if (!access.ok) return refusal(access);
  try {
    return NextResponse.json({ authorization: await fetchAdAuthorization(access.token, access.businessId, item.data) }, { headers: noStore });
  } catch (e) {
    const failed = tiktokFailure(e, "the ad authorization");
    if (failed) return failed;
    log.error("Ad authorization read failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Failed to read the ad authorization" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rl = rateLimit({ key: rateLimitKey("portal/tiktok-business/ad-code", req), limit: 20, windowMs: 60_000 });
  if (!rl.allowed)
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400, headers: noStore });
  const access = await tiktokBusinessAccess(session.creatorUserId);
  if (!access.ok) return refusal(access);

  const { action, item } = parsed.data;
  try {
    if (action === "delete") {
      await deleteAdAuthorization(access.token, access.businessId, item);
      log.info("Ad authorization deleted");
      return NextResponse.json({ authorization: { enabled: false } }, { headers: noStore });
    }
    const authorization =
      action === "enable"
        ? await enableAdAuthorization(access.token, access.businessId, item, parsed.data.days)
        : await extendAdAuthorization(access.token, access.businessId, item, parsed.data.days);
    log.info(`Ad authorization ${action}d`, { days: parsed.data.days });
    return NextResponse.json({ authorization }, { headers: noStore });
  } catch (e) {
    const failed = tiktokFailure(e, "the ad authorization");
    if (failed) return failed;
    log.error("Ad authorization change failed", { action, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Failed to change the ad authorization" }, { status: 500 });
  }
}
