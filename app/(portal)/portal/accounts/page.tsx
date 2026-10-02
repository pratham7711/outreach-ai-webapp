"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PlatformCapability } from "@/lib/capabilities";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";
import { OAUTH_PLATFORMS, toPlatformEnum, type OAuthPlatform } from "@/lib/oauth/providers";
import { WHAT_WE_NEVER_DO, WHAT_WE_READ } from "@/lib/portal/whatWeRead";
import { Button, useConfirm } from "@/components/ds";
import {
  Banner,
  ButtonLink,
  Card,
  LoadFailed,
  Screen,
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
    platform INSTAGRAM, so they are told apart by what the creator has. */
const CARD_LABEL: Record<OAuthPlatform, string> = {
  instagram: "Instagram",
  "instagram-login": "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook Page",
  threads: "Threads",
};
const CARD_NOTE: Partial<Record<OAuthPlatform, string>> = {
  instagram: "Through the Facebook Page your Instagram is linked to.",
  "instagram-login": "For a professional account with no Facebook Page.",
};

const RETURN_TO = "/portal/accounts";

/** The OAuth callback comes back with ?connected=<platform> or
    ?error=<platform>&reason=<step>. Read once, during the first render: an
    effect-fired toast never appeared on this redirect (see the old Settings
    screen, measured 2026-09-09), and a banner can be read twice. */
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

function WhatWeRead({ platform }: { platform: OAuthPlatform }) {
  return (
    <details style={{ marginTop: 10 }}>
      <summary className="rsp-touch" style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--cc-primary)", display: "flex", alignItems: "center" }}>
        What we read
      </summary>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
        {WHAT_WE_READ[platform].map((r) => (
          <li key={r.scope} style={{ fontSize: 13, color: "var(--cc-text)", lineHeight: 1.5 }}>
            {r.reads} <span style={{ color: "var(--cc-text-muted)", fontSize: 12 }}>({r.scope.replace("https://www.googleapis.com/auth/", "")})</span>
          </li>
        ))}
      </ul>
    </details>
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
}: {
  platform: OAuthPlatform;
  accounts: Connection[];
  reconnect: Set<string>;
  publicProfile: PublicProfile | null;
  capability: PlatformCapability | undefined;
  onDisconnect: (account: Connection) => void;
  disconnectingId: string | null;
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

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{CARD_LABEL[platform]}</h2>
          {CARD_NOTE[platform] && <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "2px 0 0" }}>{CARD_NOTE[platform]}</p>}
        </div>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </div>

      {accounts.map((a) => {
        const lapsed = reconnect.has(a.id);
        return (
          <div key={a.id} style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--cc-bg)", border: "1px solid var(--cc-border)" }}>
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
                <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                  {formatCount(a.followersCount)} followers ·{" "}
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
          </div>
        );
      })}

      {accounts.length === 0 && publicProfile && (
        <p style={{ fontSize: 13, color: "var(--cc-text)", margin: "10px 0 0", lineHeight: 1.5 }}>
          We read the public numbers of <strong>{publicProfile.handle}</strong>
          {publicProfile.lastReadAt ? `, last on ${formatDay(publicProfile.lastReadAt)}` : ""}. Connect it to add insights and keep them current.
        </p>
      )}

      {comingSoon ? (
        capability?.connectNote && <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "10px 0 0" }}>{capability.connectNote}</p>
      ) : (
        <div style={{ marginTop: 12 }}>
          <ButtonLink href={startHref} external variant={accounts.length > 0 ? "secondary" : "primary"}>
            {accounts.length > 0 ? "Add another" : "Connect"}
          </ButtonLink>
          {capability?.connect === "gated" && capability.connectNote && accounts.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "8px 0 0" }}>{capability.connectNote}</p>
          )}
        </div>
      )}

      <WhatWeRead platform={platform} />
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
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [reconnect, setReconnect] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [result] = useState(readConnectResult);
  const [resultShown, setResultShown] = useState(true);

  useEffect(() => {
    if (result) window.history.replaceState(null, "", window.location.pathname);
  }, [result]);

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
  const otherPublic = profiles.filter((p) => !cardPlatforms.has(p.platform));

  return (
    <Screen title="My accounts" subtitle="Connect your accounts so your posts report their own numbers.">
      {result && resultShown && (
        <Banner tone={result.tone} onDismiss={() => setResultShown(false)}>
          {result.text}
        </Banner>
      )}
      {failed && <LoadFailed what="your accounts" onRetry={load} />}

      <Card style={{ marginBottom: 16 }}>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {WHAT_WE_NEVER_DO.map((line) => (
            <li key={line} style={{ fontSize: 13, color: "var(--cc-text)", lineHeight: 1.5 }}>
              {line}
            </li>
          ))}
        </ul>
      </Card>

      {!connections && !failed ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SkeletonBlock height={120} />
          <SkeletonBlock height={120} />
          <SkeletonBlock height={120} />
        </div>
      ) : (
        connections && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {OAUTH_PLATFORMS.map((platform) => (
              <PlatformCard
                key={platform}
                platform={platform}
                accounts={accountsFor(platform)}
                reconnect={reconnect}
                publicProfile={publicFor(platform)}
                capability={capabilities.find((c) => c.platform === platform)}
                onDisconnect={disconnect}
                disconnectingId={disconnectingId}
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
