"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, MessageSquareOff, ShieldCheck, Unplug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PlatformCapability } from "@/lib/capabilities";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";
import { OAUTH_PLATFORMS, toPlatformEnum, type OAuthPlatform } from "@/lib/oauth/providers";
import { WHAT_WE_NEVER_DO, WHAT_WE_READ } from "@/lib/portal/whatWeRead";
import { Button, useConfirm } from "@/components/ds";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import {
  Banner,
  ButtonLink,
  Card,
  LoadFailed,
  Screen,
  SectionTitle,
  SkeletonBlock,
  StatusPill,
  formatCount,
  formatDay,
  platformLabel,
  relativeDay,
  type Tone,
} from "@/components/portal/app/ui";

type Connection = {
  id: string;
  platform: string;
  handle: string;
  profileUrl: string | null;
  followersCount: number;
  statsSyncedAt: string | null;
  origin: string | null;
};

type PublicProfile = { platform: string; handle: string; lastReadAt: string | null };

/** How each connect flow is named to a creator. Both Instagram flows store
    platform INSTAGRAM, so they are told apart by what the creator has, and
    never share a title: two cards both called "Instagram" read as a duplicate.
    Same names as the agency's connect link (lib/portal/permissionCopy.ts). */
const CARD_LABEL: Record<OAuthPlatform, string> = {
  instagram: "Instagram (via Facebook Page)",
  "instagram-login": "Instagram (Instagram login)",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook Page",
  threads: "Threads",
};
const CARD_NOTE: Partial<Record<OAuthPlatform, string>> = {
  instagram: "Through the Facebook Page your Instagram is linked to.",
  "instagram-login": "For a professional account with no Facebook Page.",
};
/** What the Connect button names: the platform the creator signs in to. */
const BUTTON_NAME: Record<OAuthPlatform, string> = {
  instagram: "Instagram",
  "instagram-login": "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook Page",
  threads: "Threads",
};
/** One icon per line of WHAT_WE_NEVER_DO, in its order. */
const NEVER_ICONS: LucideIcon[] = [ShieldCheck, MessageSquareOff, Unplug];

const RETURN_TO = "/portal/accounts";

/** The OAuth callback comes back with ?connected=<platform> or
    ?error=<platform>&reason=<step>. Shown as a banner rather than a toast: an
    effect-fired toast never appeared on this redirect (see the old Settings
    screen, measured 2026-09-09), and a banner can be read twice. Read after
    mount, not during the first render: the server never sees the query, so a
    banner rendered on the client's first pass failed hydration. */
function readConnectResult(): { tone: "success" | "danger"; text: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("connected");
  const failed = params.get("error");
  if (!connected && !failed) return null;
  const slug = (connected ?? failed ?? "") as OAuthPlatform;
  const name = CARD_LABEL[slug] ?? slug;
  if (connected) return { tone: "success", text: `${name} connected. Your numbers will appear in My stats.` };
  const reason = params.get("reason");
  if (reason === "creator")
    return {
      tone: "danger",
      text: `Couldn't connect ${name}: you need to be on a campaign first. Join one from Campaigns → Open, or accept an agency's invite, then connect.`,
    };
  if (reason === "provider")
    return { tone: "danger", text: `${name} sign-in isn't switched on yet. You can still submit post links on your campaigns.` };
  return {
    tone: "danger",
    text: reason
      ? `Couldn't connect ${name} (${reason.replace(/_/g, " ")}). Try again, and tell the agency if it keeps failing.`
      : `Couldn't connect ${name}. Try again, and tell the agency if it keeps failing.`,
  };
}

/* A button rather than <details>/<summary>: the phone touch rule in
   globals.css (rsp-touch, 44px) reaches buttons and links, not a summary. */
function WhatWeRead({ platform }: { platform: OAuthPlatform }) {
  const [open, setOpen] = useState(false);
  const id = `what-we-read-${platform}`;
  return (
    <>
      <button
        type="button"
        className="rsp-touch"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 0",
          border: "none",
          background: "none",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--cc-primary)",
        }}
      >
        {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        What we read
      </button>
      {open && (
        <ul id={id} style={{ flex: "1 1 100%", minWidth: 0, margin: "0 0 2px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {WHAT_WE_READ[platform].map((r) => (
            <li key={r.scope} style={{ fontSize: 13, color: "var(--cc-text)", lineHeight: 1.5 }}>
              {r.reads} <span style={{ color: "var(--cc-text-muted)", fontSize: 12 }}>({r.scope.replace("https://www.googleapis.com/auth/", "")})</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PlatformCard({
  platform,
  accounts,
  reconnect,
  publicProfile,
  capability,
  onDisconnect,
  disconnectingId,
  canConnect,
}: {
  platform: OAuthPlatform;
  accounts: Connection[];
  reconnect: Set<string>;
  publicProfile: PublicProfile | null;
  capability: PlatformCapability | undefined;
  onDisconnect: (account: Connection) => void;
  disconnectingId: string | null;
  canConnect: boolean;
}) {
  const startHref = `/api/portal/connections/${platform}/start?returnTo=${encodeURIComponent(RETURN_TO)}`;
  const comingSoon = capability?.connect === "coming_soon";
  const anyReconnect = accounts.some((a) => reconnect.has(a.id));

  const state: { tone: Tone; label: string } =
    accounts.length > 0
      ? anyReconnect
        ? { tone: "warning", label: "Reconnect needed" }
        : { tone: "success", label: "Connected" }
      : publicProfile
        ? { tone: "neutral", label: "Public only" }
        : { tone: "neutral", label: comingSoon ? "Coming soon" : "Not connected" };

  const gated = comingSoon || (capability?.connect === "gated" && process.env.NODE_ENV === "production");
  const followerWord = platform === "youtube" ? "subscribers" : "followers";

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 16 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "var(--cc-bg)",
            border: "1px solid var(--cc-border)",
            color: "var(--cc-text)",
          }}
        >
          <PlatformGlyph platform={toPlatformEnum(platform)} size={20} />
        </span>
        <div style={{ minWidth: 0, flex: 1, minHeight: 40, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <h2 style={{ flex: "1 1 auto", minWidth: 0, fontSize: 16, fontWeight: 700, color: "var(--cc-text)", margin: 0, lineHeight: 1.35, paddingTop: 1 }}>
              {CARD_LABEL[platform]}
            </h2>
            <span style={{ flex: "none" }}>
              <StatusPill tone={state.tone}>{state.label}</StatusPill>
            </span>
          </div>
          {CARD_NOTE[platform] && <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "2px 0 0", lineHeight: 1.45 }}>{CARD_NOTE[platform]}</p>}
          {accounts.length === 0 && publicProfile && (
            <p style={{ fontSize: 13, color: "var(--cc-text)", margin: "6px 0 0", lineHeight: 1.5 }}>
              We read the public numbers of <strong>{publicProfile.handle}</strong>
              {publicProfile.lastReadAt ? `, last on ${formatDay(publicProfile.lastReadAt)}` : ""}. Connect it to add insights and keep them current.
            </p>
          )}
        </div>
      </div>

      {accounts.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {accounts.map((a) => {
            const lapsed = reconnect.has(a.id);
            return (
              <li key={a.id} style={{ borderTop: "1px solid var(--cc-border)", padding: "12px 16px 12px 68px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflowWrap: "anywhere" }}>
                      {a.profileUrl ? (
                        <a href={a.profileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--cc-text)" }}>
                          {a.handle}
                        </a>
                      ) : (
                        a.handle
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--cc-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {formatCount(a.followersCount)} {followerWord} ·{" "}
                      {a.statsSyncedAt ? `last synced ${formatDay(a.statsSyncedAt)} (${relativeDay(a.statsSyncedAt)})` : "not synced yet"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {lapsed && (
                      <ButtonLink href={startHref} external>
                        Reconnect
                      </ButtonLink>
                    )}
                    <Button variant="ghost" size="sm" loading={disconnectingId === a.id} onClick={() => onDisconnect(a)}>
                      Disconnect
                    </Button>
                  </div>
                </div>
                {lapsed && (
                  <p style={{ fontSize: 13, color: "var(--cc-text)", margin: "8px 0 0" }}>
                    Access to this account has lapsed, so its numbers have stopped updating.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px 16px",
          flexWrap: "wrap",
          borderTop: "1px solid var(--cc-border)",
          padding: "12px 16px 10px 68px",
        }}
      >
        {/* A gated platform in production has no credentials behind it: the
            start route can only bounce the creator back with reason=provider,
            so the button is left out and the note says what to do instead.
            Development keeps it, because there the route runs a mock flow. */}
        {gated ? (
          capability?.connectNote && <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>{capability.connectNote}</p>
        ) : !canConnect ? null : (
          <>
            <ButtonLink href={startHref} external variant={accounts.length > 0 ? "secondary" : "primary"}>
              {accounts.length > 0 ? "Add another account" : `Connect ${BUTTON_NAME[platform]}`}
            </ButtonLink>
            {capability?.connect === "gated" && capability.connectNote && accounts.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0, flex: "1 1 220px" }}>{capability.connectNote}</p>
            )}
          </>
        )}
        <WhatWeRead platform={platform} />
      </div>
    </Card>
  );
}

/**
 * My accounts: per platform, Connected · Reconnect needed · Public only, when
 * it last synced, what we read in plain words per permission, and Disconnect.
 * This replaces the Connect list that sat inside portal Settings; /portal/settings
 * now redirects here (next.config.ts), query string and all, so an OAuth
 * callback that still returns to Settings lands on this banner.
 *
 * "Reconnect needed" is not stored on the account row. It comes from
 * /api/portal/insights, which tries each token and reports the ones that can
 * no longer be refreshed, so it arrives a moment after the list.
 */
export default function MyAccountsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [capabilities, setCapabilities] = useState<PlatformCapability[]>([]);
  const [canConnect, setCanConnect] = useState(true);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [reconnect, setReconnect] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnType<typeof readConnectResult>>(null);
  const [resultShown, setResultShown] = useState(true);

  useEffect(() => {
    const read = readConnectResult();
    if (!read) return;
    setResult(read);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [connRes, pubRes] = await Promise.all([
        fetch("/api/portal/connections"),
        fetch("/api/portal/accounts/public"),
      ]);
      if (connRes.status === 401) {
        router.push("/portal/login");
        return;
      }
      if (!connRes.ok) throw new Error("connections");
      const data = await connRes.json();
      /* An agency's hand-typed row holds no credential; it is a public
         profile, not a connection. */
      setConnections((data.accounts ?? []).filter((a: Connection) => a.origin !== "manual"));
      setCapabilities(data.capabilities ?? []);
      setCanConnect(data.canConnect !== false);
      if (pubRes.ok) setProfiles((await pubRes.json()).profiles ?? []);
    } catch {
      setFailed(true);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!connections || connections.length === 0) return;
    let cancelled = false;
    fetch("/api/portal/insights")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.platforms) return;
        const lapsed = (data.platforms as Array<{ accountId: string; needsReconnect: boolean }>)
          .filter((p) => p.needsReconnect)
          .map((p) => p.accountId);
        setReconnect(new Set(lapsed));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connections]);

  const disconnect = async (account: Connection) => {
    const ok = await confirm({
      title: `Disconnect ${account.handle}?`,
      description: "We delete our access to this account straight away. Posts you already submitted stay on your campaigns, but their numbers stop updating.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    setDisconnectingId(account.id);
    try {
      const res = await fetch(`/api/portal/connections?id=${encodeURIComponent(account.id)}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Disconnected");
        await load();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't disconnect");
      }
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setDisconnectingId(null);
    }
  };

  const accountsFor = (platform: OAuthPlatform) =>
    (connections ?? []).filter(
      (c) =>
        c.platform === toPlatformEnum(platform) &&
        (c.platform !== "INSTAGRAM" || isInstagramLoginRow(c.origin) === (platform === "instagram-login")),
    );

  /* A public profile belongs on its platform's card; for Instagram, on the
     first card only, so it is not listed twice. */
  const publicFor = (platform: OAuthPlatform) =>
    platform === "instagram-login" ? null : profiles.find((p) => p.platform === toPlatformEnum(platform)) ?? null;
  const cardPlatforms = new Set<string>(OAUTH_PLATFORMS.map((p) => toPlatformEnum(p)));
  /* A platform switched to "coming soon" has nothing to offer a creator but a
     disabled card, so it is left off the list, unless the creator already has
     an account on it and needs the card to disconnect it. */
  const shown = OAUTH_PLATFORMS.filter(
    (platform) =>
      capabilities.find((c) => c.platform === platform)?.connect !== "coming_soon" || accountsFor(platform).length > 0,
  );
  const otherPublic = profiles.filter((p) => !cardPlatforms.has(p.platform));
  const connectedCount = shown.filter((platform) => accountsFor(platform).length > 0).length;

  return (
    <Screen title="My accounts" subtitle="Connect your accounts so your posts report their own numbers.">
      {result && resultShown && (
        <Banner tone={result.tone} onDismiss={() => setResultShown(false)}>
          {result.text}
        </Banner>
      )}
      {failed && <LoadFailed what="your accounts" onRetry={load} />}

      {connections && !canConnect && (
        <Card style={{ marginBottom: 16, padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Join a campaign to connect</h2>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: "6px 0 14px", lineHeight: 1.5, maxWidth: 560 }}>
            A connection is linked to the agency running your campaign, so Connect opens once you are on one. Join an
            open campaign, or open the link an agency sent you.
          </p>
          <ButtonLink href="/portal/campaigns?tab=open">Browse open campaigns</ButtonLink>
        </Card>
      )}

      <ul
        aria-label="What we never do"
        style={{
          listStyle: "none",
          margin: "0 0 20px",
          padding: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "10px 20px",
        }}
      >
        {WHAT_WE_NEVER_DO.map((line, i) => {
          const Icon = NEVER_ICONS[i] ?? ShieldCheck;
          return (
            <li key={line} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--cc-text)", lineHeight: 1.45 }}>
              <Icon size={16} aria-hidden="true" style={{ flex: "none", marginTop: 1, color: "var(--cc-text-muted)" }} />
              <span>{line}</span>
            </li>
          );
        })}
      </ul>

      {!connections && !failed ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SkeletonBlock height={120} />
          <SkeletonBlock height={120} />
          <SkeletonBlock height={120} />
        </div>
      ) : (
        connections && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionTitle
              aside={
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {connectedCount} of {shown.length} connected
                </span>
              }
            >
              Platforms
            </SectionTitle>
            {shown.map((platform) => (
              <PlatformCard
                key={platform}
                platform={platform}
                accounts={accountsFor(platform)}
                reconnect={reconnect}
                publicProfile={publicFor(platform)}
                capability={capabilities.find((c) => c.platform === platform)}
                onDisconnect={disconnect}
                disconnectingId={disconnectingId}
                canConnect={canConnect}
              />
            ))}
            {otherPublic.length > 0 && (
              <Card>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Other public profiles</h2>
                <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "4px 0 8px" }}>
                  Read from what anyone can see; there is nothing to connect on these platforms.
                </p>
                {otherPublic.map((p) => (
                  <p key={`${p.platform}-${p.handle}`} style={{ fontSize: 14, color: "var(--cc-text)", margin: "4px 0" }}>
                    {platformLabel(p.platform)} · {p.handle}
                    {p.lastReadAt && <span style={{ color: "var(--cc-text-muted)" }}> · last read {formatDay(p.lastReadAt)}</span>}
                  </p>
                ))}
              </Card>
            )}
          </div>
        )
      )}
    </Screen>
  );
}
