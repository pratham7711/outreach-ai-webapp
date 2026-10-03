import { cache } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { POWERED_BY } from "@/lib/brand";
import { LegalLinks } from "@/components/LegalLinks";
import { resolveConnectToken, type ConnectBinding } from "@/lib/creators/connectToken";
import { isOAuthPlatform, isProviderConfigured, type OAuthPlatform } from "@/lib/oauth/providers";
import { resolvePlatformCapability } from "@/lib/capabilities";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";
import { CONNECT_READS, NEVER_DONE } from "@/lib/portal/permissionCopy";

export const dynamic = "force-dynamic";

/**
 * /connect/<token> — the agency's connect link for one roster creator.
 *
 * No login: the token is bound to one roster row, and "Continue with …" starts
 * the ordinary OAuth flow with the token attached (the start and callback URLs
 * are the pinned ones). Consent lands back here with ?connected=<platform>,
 * and the page says in plain words what that agency now sees.
 *
 * Phone first: these links are opened inside Instagram, TikTok and WhatsApp.
 * Signed out by design, so /connect must be on the signed-out allowlist in
 * proxy.ts for this to render without a login.
 */

/* Instagram twice: through a Facebook Page (the approved path, and the only
   one with Business Discovery) and directly (for creators with no Page). */
const OFFERED: OAuthPlatform[] = ["instagram", "instagram-login", "tiktok", "youtube"];

/* Unlisted on purpose, and the token must not leak to the providers through
   the Referer header on the way out. */
const robots = { index: false, follow: false };

const loadLink = cache(async (token: string) => {
  const binding = await resolveConnectToken(token);
  if (!binding) return null;
  const org = await db.organization.findUnique({
    where: { id: binding.orgId },
    select: { name: true },
  });
  return { binding, agency: org?.name ?? "Your agency" };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const link = await loadLink(token);
  return {
    title: link ? `Connect your accounts | ${link.agency}` : "Link unavailable",
    robots,
    referrer: "no-referrer",
  };
}

function available(platform: OAuthPlatform): boolean {
  if (resolvePlatformCapability(platform).connect === "coming_soon") return false;
  /* Outside production an unconfigured platform still connects through the
     dev shortcut, which is how this journey is walked locally. */
  return isProviderConfigured(platform) || process.env.NODE_ENV !== "production";
}

async function connectedPlatforms(binding: ConnectBinding): Promise<Set<OAuthPlatform>> {
  const rows = await db.creatorSocialAccount.findMany({
    where: { creatorId: binding.creatorId, creator: { orgId: binding.orgId } },
    select: { platform: true, origin: true },
  });
  const out = new Set<OAuthPlatform>();
  for (const row of rows) {
    if (row.platform === "INSTAGRAM") out.add(isInstagramLoginRow(row.origin) ? "instagram-login" : "instagram");
    else if (row.platform === "TIKTOK") out.add("tiktok");
    else if (row.platform === "YOUTUBE") out.add("youtube");
    else if (row.platform === "FACEBOOK") out.add("facebook");
    else if (row.platform === "THREADS") out.add("threads");
  }
  return out;
}

function errorText(agency: string, error: string | undefined, reason: string | undefined): string | null {
  if (!error) return null;
  if (error === "link" || reason === "link")
    return `This link was turned off before you finished. Ask ${agency} for a new one.`;
  const label = isOAuthPlatform(error) ? CONNECT_READS[error].label : "That account";
  if (reason === "provider") return `${label} can't be connected right now. Try again later.`;
  if (reason === "identity") return `${label} didn't tell us which account you connected. Try again.`;
  return `Connecting ${label} didn't finish. Try again.`;
}

const page: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--cc-bg)",
  color: "var(--cc-text)",
  padding: "24px 16px 32px",
};
const column: React.CSSProperties = {
  maxWidth: 480,
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};
const card: React.CSSProperties = {
  background: "var(--cc-card)",
  border: "1px solid var(--cc-border)",
  borderRadius: 12,
  padding: 16,
};
const muted: React.CSSProperties = { color: "var(--cc-text-muted)", fontSize: 14, lineHeight: 1.5 };

function ReadsList({ platform }: { platform: OAuthPlatform }) {
  return (
    <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
      {CONNECT_READS[platform].lines.map((line) => (
        <li key={line.scope} style={muted}>
          {line.reads}
        </li>
      ))}
    </ul>
  );
}

function Gone() {
  return (
    <main style={page}>
      <div style={column}>
        <div style={card}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>This link is no longer active</h1>
          <p style={{ ...muted, marginTop: 8 }}>
            It may have been turned off or replaced, or the address is incomplete. Ask whoever sent it
            for a new one.
          </p>
        </div>
        <footer style={{ ...muted, fontSize: 12, textAlign: "center", display: "grid", gap: 6 }}>
          {POWERED_BY}
          <LegalLinks />
        </footer>
      </div>
    </main>
  );
}

export default async function ConnectLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ connected?: string; error?: string; reason?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const link = await loadLink(token);
  if (!link) return <Gone />;

  const { binding, agency } = link;
  const connected = await connectedPlatforms(binding);
  const justConnected =
    query.connected && isOAuthPlatform(query.connected) ? query.connected : null;
  const problem = errorText(agency, query.error, query.reason);
  const offered = OFFERED.filter(available);
  const startHref = (platform: OAuthPlatform) =>
    `/api/portal/connections/${platform}/start?connect=${encodeURIComponent(token)}`;

  return (
    <main style={page}>
      <div style={column}>
        {justConnected ? (
          <div style={card}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              Connected. Here&rsquo;s what {agency} now sees
            </h1>
            <p style={{ ...muted, marginTop: 8 }}>From your {CONNECT_READS[justConnected].label} account:</p>
            <ReadsList platform={justConnected} />
          </div>
        ) : (
          <div style={card}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Connect your accounts</h1>
            <p style={{ ...muted, marginTop: 8 }}>
              {agency} asked you to connect, so your campaign numbers come straight from the platform
              instead of screenshots. No account or password needed here.
            </p>
          </div>
        )}

        {problem && (
          <div
            role="alert"
            style={{ ...card, borderColor: "var(--cc-danger)", color: "var(--cc-danger-ink)", fontSize: 14 }}
          >
            {problem}
          </div>
        )}

        {offered.map((platform) => {
          const isConnected = connected.has(platform);
          return (
            <div key={platform} style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{CONNECT_READS[platform].label}</span>
                {isConnected && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-success)" }}>Connected</span>
                )}
              </div>
              {!justConnected || justConnected !== platform ? (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ ...muted, cursor: "pointer" }}>What {agency} will see</summary>
                  <ReadsList platform={platform} />
                </details>
              ) : null}
              <a
                href={startHref(platform)}
                style={{
                  display: "block",
                  marginTop: 12,
                  textAlign: "center",
                  padding: "12px 16px",
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  textDecoration: "none",
                  background: isConnected ? "var(--cc-card)" : "var(--cc-primary)",
                  color: isConnected ? "var(--cc-primary)" : "var(--cc-on-primary)",
                  border: "1.5px solid var(--cc-primary)",
                }}
              >
                {isConnected
                  ? `Connect another ${CONNECT_READS[platform].label} account`
                  : `Continue with ${CONNECT_READS[platform].label}`}
              </a>
            </div>
          );
        })}

        <p style={{ ...muted, fontSize: 13 }}>{NEVER_DONE}</p>

        {connected.size > 0 && (
          <a
            href={`/portal/register?connect=${encodeURIComponent(token)}`}
            style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-primary)", textAlign: "center" }}
          >
            Create a login to see your campaigns
          </a>
        )}

        <footer style={{ ...muted, fontSize: 12, textAlign: "center", display: "grid", gap: 6 }}>
          {POWERED_BY}
          <LegalLinks />
        </footer>
      </div>
    </main>
  );
}
