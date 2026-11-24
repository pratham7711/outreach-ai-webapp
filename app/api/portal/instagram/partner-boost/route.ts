import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCreatorSession } from "@/lib/creator-auth";
import { brandPartnersFor, ownInstagram } from "@/lib/portal/instagramOwnAccount";
import { InstagramAuthError } from "@/lib/platforms/instagram";
import { mediaBelongsTo } from "@/lib/platforms/instagramComments";
import { approvedBoostPartners, setBoostPermission } from "@/lib/platforms/instagramPartnership";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/observability/logger";
import { metaDemoMocked, metaReviewScopesOn } from "@/lib/oauth/metaReviewScopes";

/**
 * "Allow brand partner to boost" on one of the creator's OWN branded posts
 * (instagram_branded_content_creator). GET ?account=&media= lists the brands
 * of the organisations the creator works with and which of them may boost the
 * post; POST turns it on or off for one of those brands.
 */
export const dynamic = "force-dynamic";

const log = createLogger({ context: { platform: "INSTAGRAM", call: "portal.partnerBoost" } });
const noStore = { "Cache-Control": "no-store" };
const ID = /^[0-9A-Za-z_-]{1,64}$/;
const change = z.object({ account: z.string().regex(ID), media: z.string().regex(ID), sponsorId: z.string().regex(ID), allow: z.boolean() });

function refused(e: unknown) {
  if (e instanceof InstagramAuthError)
    return NextResponse.json(
      { error: "permission", reason: "Instagram refused this. Reconnect Instagram from My accounts and allow partnership ads." },
      { status: 409, headers: noStore },
    );
  return null;
}

export async function GET(req: NextRequest) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!metaReviewScopesOn() && !metaDemoMocked()) return NextResponse.json({ error: "not_enabled" }, { status: 404, headers: noStore });
  const account = req.nextUrl.searchParams.get("account") ?? "";
  const media = req.nextUrl.searchParams.get("media") ?? "";
  if (!ID.test(account) || !ID.test(media)) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: noStore });
  const own = await ownInstagram(session, account);
  if (!own.ok) return NextResponse.json({ error: own.error, reason: own.reason }, { status: own.status, headers: noStore });
  try {
    if (!(await mediaBelongsTo(own.token, media, own.igUserId)))
      return NextResponse.json({ error: "not_your_post", reason: "This post is not on your connected Instagram account." }, { status: 404, headers: noStore });
    const [partners, approved] = await Promise.all([brandPartnersFor(own.orgIds), approvedBoostPartners(own.token, media)]);
    return NextResponse.json(
      { partners: partners.map((p) => ({ ...p, allowed: approved?.includes(p.sponsorId) ?? false })), readable: approved !== null },
      { headers: noStore },
    );
  } catch (e) {
    const r = refused(e);
    if (r) return r;
    log.error("Partner boost read failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "Failed to read boost permissions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!metaReviewScopesOn() && !metaDemoMocked()) return NextResponse.json({ error: "not_enabled" }, { status: 404, headers: noStore });
  const rl = rateLimit({ key: rateLimitKey("portal/instagram/partner-boost", req), limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });
  const parsed = change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400, headers: noStore });
  const own = await ownInstagram(session, parsed.data.account);
  if (!own.ok) return NextResponse.json({ error: own.error, reason: own.reason }, { status: own.status, headers: noStore });
  try {
    if (!(await mediaBelongsTo(own.token, parsed.data.media, own.igUserId)))
      return NextResponse.json({ error: "not_your_post", reason: "This post is not on your connected Instagram account." }, { status: 404, headers: noStore });
    /* Only a brand of an organisation this creator works with. */
    const partners = await brandPartnersFor(own.orgIds);
    if (!partners.some((p) => p.sponsorId === parsed.data.sponsorId))
      return NextResponse.json({ error: "unknown_partner", reason: "That brand is not one you work with here." }, { status: 404, headers: noStore });
    const done = await setBoostPermission(own.token, parsed.data.media, parsed.data.sponsorId, parsed.data.allow);
    log.info("Partner boost changed", { allow: parsed.data.allow, done });
    if (!done) return NextResponse.json({ error: "not_done", reason: "Instagram did not accept that. The post must tag this brand as a paid partner." }, { status: 502, headers: noStore });
    return NextResponse.json({ ok: true, allowed: parsed.data.allow }, { headers: noStore });
  } catch (e) {
    const r = refused(e);
    if (r) return r;
    log.error("Partner boost change failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "Failed to change boost permission" }, { status: 500 });
  }
}
