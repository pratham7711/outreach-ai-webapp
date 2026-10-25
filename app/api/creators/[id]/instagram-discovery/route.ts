import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { getAgencyDiscoveryCredential } from "@/lib/platforms/instagramAgencyCredential";
import { readDiscoveryProfile, normalizeHandle, isInstagramUsername } from "@/lib/platforms/instagramDiscoveryProfile";
import { InstagramAuthError, InstagramNoSuchAccountError } from "@/lib/platforms/instagram";
import { createLogger } from "@/lib/observability/logger";

/**
 * GET /api/creators/[id]/instagram-discovery — the public profile and recent
 * posts of the creator's Instagram professional account, read through Business
 * Discovery on behalf of the agency's OWN Instagram account.
 *
 * Only the agency's own connection is used. An org that has not connected one
 * gets a prompt to connect it, never a read through any other credential.
 * Read live on every request; nothing is cached or stored.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const log = createLogger({ context: { call: "creator.instagram.discovery" } });

const noStore = { "Cache-Control": "no-store" };

function refuse(status: number, error: string, reason: string) {
  return NextResponse.json({ error, reason }, { status, headers: noStore });
}

async function instagramHandle(orgId: string, creator: { id: string; platform: string; handle: string }) {
  if (creator.platform === "INSTAGRAM" && creator.handle) return creator.handle;
  try {
    const link = await db.creatorProfileLink.findFirst({
      where: { creatorId: creator.id, orgId, platform: "INSTAGRAM" },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { handle: true },
    });
    return link?.handle ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = auth;
    const { id } = await params;

    const creator = await db.creator.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true, platform: true, handle: true },
    });
    if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const raw = await instagramHandle(orgId, creator);
    const handle = raw ? normalizeHandle(raw) : "";
    if (!isInstagramUsername(handle)) return refuse(409, "no_instagram_handle", "This creator has no Instagram handle on your roster.");

    const agency = await getAgencyDiscoveryCredential(orgId);
    if (!agency)
      return refuse(
        409,
        "no_agency_account",
        "Connect your agency's Instagram professional account in Settings > Integrations to read public Instagram profiles.",
      );

    let profile;
    try {
      profile = await readDiscoveryProfile(handle, agency);
    } catch (err) {
      if (err instanceof InstagramAuthError) {
        log.warn("Business Discovery rejected the agency's token", { status: err.status });
        return refuse(409, "agency_reauthorize", "Instagram rejected your agency's connection. Reconnect it in Settings > Integrations.");
      }
      if (err instanceof InstagramNoSuchAccountError)
        return refuse(404, "not_professional", `@${handle} is not a public Instagram Business or Creator account, so Instagram shares nothing about it.`);
      throw err;
    }
    if (!profile) return refuse(502, "unreadable", "Instagram did not answer just now. Try again in a moment.");

    return NextResponse.json(
      { profile, via: { username: agency.username }, readAt: new Date().toISOString(), stored: false },
      { headers: noStore },
    );
  } catch (error) {
    log.error("Failed to read a creator's public Instagram profile", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to read the profile" }, { status: 500 });
  }
}
