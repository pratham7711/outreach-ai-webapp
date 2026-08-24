"use client";

import React from "react";
import { useCallback, useEffect, useState } from "react";
import { Card, Skeleton } from "@pratham7711/ui";
import { Button } from "@/components/ds";

export const CONNECT_PLATFORMS = [
  { key: "tiktok", enumValue: "TIKTOK", label: "TikTok" },
  { key: "instagram", enumValue: "INSTAGRAM", label: "Instagram" },
  { key: "youtube", enumValue: "YOUTUBE", label: "YouTube" },
] as const;

type Account = { id: string; platform: string; handle: string };

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
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/portal/connections");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch {
      setFailed(true);
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startConnect = (key: string) => {
    const target = returnTo ?? window.location.pathname;
    window.location.href = `/api/portal/connections/${key}/start?returnTo=${encodeURIComponent(target)}`;
  };

  if (accounts === null) {
    return <Skeleton width="100%" height="120px" borderRadius="12px" />;
  }

  const missing = CONNECT_PLATFORMS.filter(
    (p) => !accounts.some((a) => a.platform === p.enumValue),
  );

  if (missing.length === 0 && variant !== "step") return null;

  const copy = COPY[variant];

  return (
    <Card variant="outlined" style={{ padding: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
        {copy.title}
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--cc-text-muted)", marginBottom: 14 }}>
        {copy.body}
      </p>

      {failed && (
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 12 }}>
          Could not check your connected accounts.{" "}
          <button
            onClick={load}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--cc-primary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Retry
          </button>
        </p>
      )}

      {missing.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
          All your accounts are connected.
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {missing.map((p) => (
            <Button key={p.key} variant="secondary" size="sm" onClick={() => startConnect(p.key)}>
              Connect {p.label}
            </Button>
          ))}
        </div>
      )}

      <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--cc-text-subtle)", marginTop: 14 }}>
        We read your public profile and public post stats only. We never post, never read your
        direct messages, and never see private videos. You can disconnect at any time from
        Settings.
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
