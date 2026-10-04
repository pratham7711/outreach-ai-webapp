"use client";

import React from "react";
import { useCallback, useEffect, useState } from "react";
import { Card, Skeleton } from "@pratham7711/ui";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ds";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { ButtonLink } from "@/components/portal/app/ui";

export const CONNECT_PLATFORMS = [
  { key: "tiktok", enumValue: "TIKTOK", label: "TikTok" },
  { key: "instagram", enumValue: "INSTAGRAM", label: "Instagram" },
  { key: "youtube", enumValue: "YOUTUBE", label: "YouTube" },
] as const;

type Account = { id: string; platform: string; handle: string };
type Capability = { platform: string; connect: string };

export type ConnectPromptVariant = "inline" | "step" | "banner";

const COPY: Record<ConnectPromptVariant, { title: string; body: string }> = {
  inline: {
    title: "Stop pasting links",
    body: "Connect your account and we'll pull the views, likes and comments for every post you publish — automatically, with no screenshots.",
  },
  step: {
    title: "Connect an account",
    body: "Brands book creators on verified reach. Connecting lets us show your real follower count and post performance instead of a number you typed in.",
  },
  banner: {
    title: "Get your performance tracked automatically",
    body: "Connect an account so your posts report themselves and brands can verify your reach.",
  },
};

const TRUST =
  "We read your profile and the numbers on your posts. We never post, edit or delete anything, and never read your direct messages. My accounts lists each permission in plain words, and you can disconnect there at any time.";

export function ConnectPrompt({
  variant = "inline",
  returnTo,
  onSkip,
  skipLabel = "Skip for now",
}: {
  variant?: ConnectPromptVariant;
  returnTo?: string;
  onSkip?: () => void;
  skipLabel?: string;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [canConnect, setCanConnect] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/portal/connections");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setAccounts(data.accounts ?? []);
      setCapabilities(data.capabilities ?? []);
      setCanConnect(data.canConnect !== false);
    } catch {
      setFailed(true);
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startHref = (key: string) => {
    const target = returnTo ?? (typeof window === "undefined" ? "/portal/accounts" : window.location.pathname);
    return `/api/portal/connections/${key}/start?returnTo=${encodeURIComponent(target)}`;
  };

  if (accounts === null) {
    return <Skeleton width="100%" height="120px" borderRadius="12px" />;
  }

  /* No roster row yet: the start route would bounce every Connect with
     reason=creator, so the step offers the way onto a campaign instead and the
     nudges elsewhere stay out of the way. */
  if (!canConnect && !failed) {
    if (variant !== "step") return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
            Find your first campaign
          </div>
          <p style={{ fontSize: "var(--cc-t-13)", lineHeight: 1.6, color: "var(--cc-text-muted)", margin: 0 }}>
            Your accounts connect to the agency running a campaign, so connecting opens once you have joined one.
            Browse what is open now, or use the link an agency sent you.
          </p>
        </div>
        {onSkip && (
          <Button variant="primary" onClick={onSkip} style={{ width: "100%" }}>
            Browse open campaigns
          </Button>
        )}
      </div>
    );
  }

  const offered = CONNECT_PLATFORMS.filter(
    (p) => capabilities.find((c) => c.platform === p.key)?.connect !== "coming_soon",
  );
  const missing = offered.filter((p) => !accounts.some((a) => a.platform === p.enumValue));

  if (missing.length === 0 && variant !== "step") return null;

  const copy = COPY[variant];

  const retry = failed && (
    <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
      Could not check your connected accounts.{" "}
      <button
        type="button"
        onClick={load}
        className="rsp-touch"
        style={{
          background: "none",
          border: "none",
          padding: 0,
          color: "var(--cc-primary)",
          cursor: "pointer",
          fontSize: "var(--cc-t-13)",
          fontWeight: 600,
        }}
      >
        Retry
      </button>
    </p>
  );

  /* The signup card is already the surface, so the step sits in it bare rather
     than as a second card inside the first. */
  if (variant === "step") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
            {copy.title}
          </div>
          <p style={{ fontSize: "var(--cc-t-13)", lineHeight: 1.6, color: "var(--cc-text-muted)", margin: 0 }}>{copy.body}</p>
        </div>
        {retry}
        {missing.length === 0 ? (
          <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0, textAlign: "center" }}>
            All your accounts are connected.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {missing.map((p) => (
              <ButtonLink
                key={p.key}
                href={startHref(p.key)}
                external
                variant="secondary"
                style={{ width: "100%", minHeight: 44, gap: 10 }}
              >
                <span aria-hidden="true" style={{ display: "inline-flex" }}>
                  <PlatformGlyph platform={p.enumValue} size={18} />
                </span>
                Continue with {p.label}
              </ButtonLink>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <ShieldCheck size={16} aria-hidden="true" style={{ flex: "none", marginTop: 2, color: "var(--cc-text-muted)" }} />
          <p style={{ fontSize: "var(--cc-t-12)", lineHeight: 1.6, color: "var(--cc-text-muted)", margin: 0 }}>{TRUST}</p>
        </div>
        {onSkip && (
          <Button variant="ghost" onClick={onSkip} style={{ width: "100%" }}>
            {skipLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card variant="outlined" style={{ padding: 20 }}>
      <div style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
        {copy.title}
      </div>
      <p style={{ fontSize: "var(--cc-t-13)", lineHeight: 1.6, color: "var(--cc-text-muted)", marginBottom: 14 }}>
        {copy.body}
      </p>

      {retry && <div style={{ marginBottom: 12 }}>{retry}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {missing.map((p) => (
          <ButtonLink key={p.key} href={startHref(p.key)} external variant="secondary" style={{ gap: 8 }}>
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <PlatformGlyph platform={p.enumValue} size={16} />
            </span>
            Connect {p.label}
          </ButtonLink>
        ))}
      </div>

      <p style={{ fontSize: "var(--cc-t-12)", lineHeight: 1.6, color: "var(--cc-text-muted)", marginTop: 14, marginBottom: 0 }}>
        {TRUST}
      </p>

      {onSkip && (
        <div style={{ marginTop: 12 }}>
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {skipLabel}
          </Button>
        </div>
      )}
    </Card>
  );
}
