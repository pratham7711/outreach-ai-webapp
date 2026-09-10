"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal, Skeleton } from "@pratham7711/ui";
import { SHARE_PLATFORMS, type SharePlatform, type ShareVisibility } from "@/lib/reports/shareVisibility";

/*
 * The campaign share link, and everything the owner can choose to put on it.
 *
 * Lifted out of PerformanceTab so the campaigns list can open the same dialog.
 * The reference has a Share button on every row, and a second, thinner
 * implementation there would be the one that forgets that PATCH keeps the token
 * while POST rotates it, or that an empty platform list means "no restriction".
 */

type ShareLink = {
  token: string;
  isPublic: boolean;
  createdAt: string;
  path: string;
  visibility: ShareVisibility;
};

const PLATFORM_LABELS: Record<SharePlatform, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
};

/** A row of the visibility panel. Label is clickable, which the bare input is not. */
function VisibilityToggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: "var(--cc-primary)", cursor: "inherit" }}
      />
      <span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{label}</span>
        {hint && (
          <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)", lineHeight: 1.5 }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

export function ShareModal({
  campaignId,
  campaignTitle,
  onClose,
}: {
  campaignId: string;
  /** Named in the title when opened from a list, where the row is the only context. */
  campaignTitle?: string;
  onClose: () => void;
}) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`);
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      setLink(json.link ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  const shareUrl = link ? `${typeof window !== "undefined" ? window.location.origin : ""}${link.path}` : "";

  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      setLink(json.link ?? null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  /* PATCH, not POST: POST rotates the token, and nobody toggling "show budget"
     is asking to break a URL they have already sent. The checkbox is optimistic
     and rolls back on failure, so it never shows a setting the link is not
     actually serving. */
  const setVisibility = async (next: ShareVisibility) => {
    if (!link) return;
    const previous = link.visibility;
    setLink({ ...link, visibility: next });
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      if (json.link) setLink(json.link);
    } catch {
      setLink((current) => (current ? { ...current, visibility: previous } : current));
      setError(true);
    }
  };

  const togglePlatform = (platform: SharePlatform, on: boolean) => {
    if (!link) return;
    const current = link.visibility.platforms;
    // Empty means "no restriction", so unchecking the last box would silently
    // widen the report to everything. Keep the other two explicitly instead.
    const next = on
      ? [...current.filter((p) => p !== platform), platform]
      : (current.length ? current : [...SHARE_PLATFORMS]).filter((p) => p !== platform);
    setVisibility({ ...link.visibility, platforms: next });
  };

  const revoke = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      setLink(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(true);
    }
  };

  return (
    <Modal open onClose={onClose} title={campaignTitle ? `Share \u2014 ${campaignTitle}` : "Share report"} size="sm">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.6 }}>
          Generate a read-only link to this campaign&apos;s performance report. Anyone with the link
          can view it — no login required. Revoke it anytime.
        </p>

        {loading ? (
          <Skeleton width="100%" height="44px" borderRadius="8px" />
        ) : link ? (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  flex: 1, minWidth: 0, fontSize: 13, color: "var(--cc-text)",
                  background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                  borderRadius: 8, padding: "8px 12px",
                }}
              />
              <button
                onClick={copy}
                style={{
                  background: "var(--cc-primary)", color: "var(--cc-card)", border: "none",
                  borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div
              style={{
                background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cc-text-subtle)", marginBottom: 8 }}>
                  Platforms included
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                  {SHARE_PLATFORMS.map((p) => {
                    const selected = link.visibility.platforms.length
                      ? link.visibility.platforms
                      : [...SHARE_PLATFORMS];
                    const on = selected.includes(p);
                    return (
                      <VisibilityToggle
                        key={p}
                        checked={on}
                        // Unchecking the last one would store an empty list,
                        // which means "no restriction" — the opposite of asking
                        // for nothing. One platform has to stay on.
                        disabled={on && selected.length === 1}
                        onChange={(next) => togglePlatform(p, next)}
                        label={PLATFORM_LABELS[p]}
                      />
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cc-text-subtle)" }}>
                  What the recipient sees
                </div>
                <VisibilityToggle
                  checked={link.visibility.showCreators}
                  onChange={(next) => setVisibility({ ...link.visibility, showCreators: next })}
                  label="Creator leaderboard"
                  hint="Names, post counts and views per creator."
                />
                <VisibilityToggle
                  checked={link.visibility.showBudget}
                  onChange={(next) => setVisibility({ ...link.visibility, showBudget: next })}
                  label="Total budget"
                  hint="Off by default — a brand does not see it unless you turn it on."
                />
                <VisibilityToggle
                  checked={link.visibility.showStatuses}
                  onChange={(next) => setVisibility({ ...link.visibility, showStatuses: next })}
                  label="Creator statuses"
                  hint="Where each activation stands, including who declined. Off by default."
                />
                <VisibilityToggle
                  checked={link.visibility.markRemovedPosts}
                  onChange={(next) => setVisibility({ ...link.visibility, markRemovedPosts: next })}
                  label="Flag removed posts"
                  hint="Off: deleted posts look like normal posts with their last recorded stats."
                />
              </div>
            </div>

            <button
              onClick={revoke}
              disabled={busy}
              style={{
                background: "var(--cc-card)", color: "var(--status-critical)", border: "1.5px solid var(--status-critical)",
                borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600,
                cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, alignSelf: "flex-start",
              }}
            >
              {busy ? "Revoking…" : "Revoke link"}
            </button>
          </>
        ) : (
          <button
            onClick={create}
            disabled={busy}
            style={{
              background: "var(--cc-primary)", color: "var(--cc-card)", border: "none",
              borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, alignSelf: "flex-start",
            }}
          >
            {busy ? "Creating…" : "Create share link"}
          </button>
        )}

        {error && (
          <p style={{ fontSize: 13, color: "var(--status-critical)", margin: 0 }}>
            Something went wrong. Please try again.
          </p>
        )}
      </div>
    </Modal>
  );
}
