import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { createAuditActor, logAudit } from "@/lib/audit";
import { isProviderConfigured } from "@/lib/oauth/providers";
import { InstagramAuthError, graphGet } from "@/lib/platforms/instagram";
import {
  agencyCredentialStatus,
  deleteAgencyCredential,
  getAgencyDiscoveryCredential,
  markAgencyCredentialRejected,
} from "@/lib/platforms/instagramAgencyCredential";
import { revokeAgencyGrantIfUnshared } from "@/lib/platforms/instagramAgencyConnect";

const PROFILE_TIMEOUT_MS = 4000;

async function requireSettingsAdmin() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const role = (session.user as any).role as string;
  const orgId = (session.user as any).orgId as string | undefined;
  if (!orgId || !hasPermission(role, "settings:*")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { orgId, session };
}

/** Picture and followers, read live: Instagram's picture URLs are signed and expire. */
async function liveProfile(orgId: string) {
  const own = await getAgencyDiscoveryCredential(orgId);
  if (!own) return null;
  try {
    const data = await graphGet(
      own.igUserId,
      { fields: "username,profile_picture_url,followers_count", access_token: own.token },
      AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    );
    return {
      username: typeof data?.username === "string" ? data.username : null,
      profilePictureUrl: typeof data?.profile_picture_url === "string" ? data.profile_picture_url : null,
      followersCount: typeof data?.followers_count === "number" ? data.followers_count : null,
    };
  } catch (err) {
    if (err instanceof InstagramAuthError) {
      await markAgencyCredentialRejected(orgId, `Instagram refused this account (${err.message})`);
    }
    return null;
  }
}

async function view(orgId: string) {
  const configured = isProviderConfigured("instagram");
  const status = await agencyCredentialStatus(orgId);
  if (!status.connected) return { configured, connected: false as const };
  const live = status.expired ? null : await liveProfile(orgId);
  const after = live ? status : await agencyCredentialStatus(orgId);
  if (!after.connected) return { configured, connected: false as const };
  return {
    configured,
    connected: true as const,
    username: live?.username ?? after.username,
    profilePictureUrl: live?.profilePictureUrl ?? null,
    followersCount: live?.followersCount ?? null,
    connectedAt: after.connectedAt,
    expiresAt: after.expiresAt,
    expired: after.expired,
    lastError: after.lastError,
  };
}

export async function GET() {
  const gate = await requireSettingsAdmin();
  if ("error" in gate) return gate.error;
  return NextResponse.json(await view(gate.orgId));
}

/** Disconnect: the row goes, and the grant at Meta too when no one else here depends on it. */
export async function DELETE() {
  const gate = await requireSettingsAdmin();
  if ("error" in gate) return gate.error;
  const { orgId, session } = gate;
  const removed = await deleteAgencyCredential(orgId);
  const revoke = removed ? await revokeAgencyGrantIfUnshared(orgId, removed.token, removed.account) : null;
  if (removed) {
    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "org.update",
      entityType: "organization",
      entityId: orgId,
      entityLabel: "Instagram Business account",
      metadata: { integration: "instagram_business", connected: false, revoke },
    });
  }
  return NextResponse.json({ ...(await view(orgId)), revoke });
}
