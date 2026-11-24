import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getAuditActor } from "@/lib/authenticate";
import { stripAt } from "@/lib/format";
import { getAgencyDiscoveryCredential } from "@/lib/platforms/instagramAgencyCredential";
import { InstagramAuthError } from "@/lib/platforms/instagram";
import { listAdPermissions, requestAdPermission, revokeAdPermission } from "@/lib/platforms/instagramPartnership";
import { metaDemoMocked, metaReviewScopesOn } from "@/lib/oauth/metaReviewScopes";
import { createLogger } from "@/lib/observability/logger";

/**
 * Partnership Ads for one rostered creator, with the agency's own Instagram
 * account as the brand (Settings → Integrations → Instagram):
 *  - the account-level partnership ad permission: request it (the creator
 *    approves or declines in the Instagram app), see where it stands, revoke
 *    it -- instagram_branded_content_ads_brand + business_management.
 * Nothing is stored here; Meta holds the permission and is read each time.
 */
export const dynamic = "force-dynamic";

const log = createLogger({ context: { platform: "INSTAGRAM", call: "agency.partnershipAds" } });
const noStore = { "Cache-Control": "no-store" };
const body = z.object({ action: z.enum(["request", "revoke"]) });

type Subject = { brand: { token: string; igUserId: string; username: string }; username: string; creatorIgId: string | null; name: string };

async function subject(orgId: string, creatorId: string): Promise<Subject | NextResponse> {
  const creator = await db.creator.findFirst({
    where: { id: creatorId, orgId, deletedAt: null },
    select: {
      name: true,
      handle: true,
      platform: true,
      socialAccounts: { where: { platform: "INSTAGRAM" }, select: { handle: true, platformUserId: true }, orderBy: { createdAt: "desc" }, take: 1 },
      profileLinks: { where: { platform: "INSTAGRAM" }, select: { handle: true }, take: 1 },
    },
  });
  if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const brand =
    (await getAgencyDiscoveryCredential(orgId)) ??
    (metaDemoMocked() ? { token: "demo-token", igUserId: "brand_demo", username: "your.brand", connectedAt: new Date() } : null);
  if (!brand)
    return NextResponse.json(
      { error: "no_brand_account", reason: "Connect your brand's Instagram account in Settings → Integrations first." },
      { status: 409, headers: noStore },
    );
  const ig = creator.socialAccounts[0];
  const raw = ig?.handle ?? creator.profileLinks[0]?.handle ?? (creator.platform === "INSTAGRAM" ? creator.handle : null);
  const username = raw ? stripAt(raw).trim() : "";
  if (!username)
    return NextResponse.json({ error: "no_instagram", reason: "This creator has no Instagram username on their profile." }, { status: 409, headers: noStore });
  return { brand, username, creatorIgId: ig?.platformUserId ?? (metaDemoMocked() ? `ig_${username.toLowerCase()}` : null), name: creator.name };
}

const notEnabled = () => (metaReviewScopesOn() || metaDemoMocked() ? null : NextResponse.json({ error: "not_enabled" }, { status: 404, headers: noStore }));

function refused(e: unknown) {
  if (e instanceof InstagramAuthError)
    return NextResponse.json(
      { error: "permission", reason: "Instagram refused this. Reconnect your brand account in Settings → Integrations and allow partnership ads." },
      { status: 409, headers: noStore },
    );
  return null;
}

async function view(s: Subject) {
  const permissions = await listAdPermissions(s.brand.token, s.brand.igUserId, s.username);
  return {
    brand: { username: s.brand.username },
    creator: { username: s.username, hasInstagramId: Boolean(s.creatorIgId) },
    permission: permissions?.[0] ?? null,
    readable: permissions !== null,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(req, "creators:read");
  if (!gate.ok) return gate.response;
  const off = notEnabled();
  if (off) return off;
  const s = await subject(gate.auth.orgId, (await params).id);
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json(await view(s), { headers: noStore });
  } catch (e) {
    const r = refused(e);
    if (r) return r;
    log.error("Partnership ads read failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Failed to read partnership ads" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(req, "creators:edit_own");
  if (!gate.ok) return gate.response;
  const off = notEnabled();
  if (off) return off;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { id } = await params;
  const s = await subject(gate.auth.orgId, id);
  if (s instanceof NextResponse) return s;

  const { action } = parsed.data;
  if (action === "revoke" && !s.creatorIgId)
    return NextResponse.json(
      { error: "no_instagram_id", reason: "The creator needs to connect Instagram before this can be changed." },
      { status: 409, headers: noStore },
    );
  try {
    const done =
      action === "request"
        ? await requestAdPermission(s.brand.token, s.brand.igUserId, s.username)
        : await revokeAdPermission(s.brand.token, s.brand.igUserId, s.creatorIgId!);
    if (!done) return NextResponse.json({ error: "not_done", reason: "Instagram did not accept that. Try again." }, { status: 502, headers: noStore });
    await logAudit({
      orgId: gate.auth.orgId,
      ...getAuditActor(gate.auth),
      action: `creator.partnership_ads.${action}`,
      entityType: "creator",
      entityId: id,
      entityLabel: s.name,
      after: { brand: s.brand.username, creator: s.username },
    });
    return NextResponse.json(await view(s), { headers: noStore });
  } catch (e) {
    const r = refused(e);
    if (r) return r;
    log.error("Partnership ads change failed", { action, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Failed to change partnership ads" }, { status: 500 });
  }
}
