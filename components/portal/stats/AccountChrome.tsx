"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { BadgeCheck, ExternalLink } from "lucide-react";
import type { PlatformInsights } from "@/lib/portal/creatorInsights";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { StatusPill, formatCount, platformLabel, secondaryButtonStyle } from "@/components/portal/app/ui";
import { NUM } from "@/components/insights/parts";

/**
 * Who each connected account is: the switcher between them, and the profile
 * header an account's dashboard opens with -- picture, name, handle, bio and
 * the counts the platform shows on the profile itself.
 */

/** The platform hues the agency's charts use (analytics/shared.ts), so a
    platform is the same colour on both sides of the product. */
export const PLATFORM_HUE: Record<PlatformInsights["platform"], string> = {
  TIKTOK: "var(--cc-cat-1)",
  INSTAGRAM: "var(--cc-cat-2)",
  YOUTUBE: "var(--cc-cat-3)",
  FACEBOOK: "var(--cc-cat-4)",
  THREADS: "var(--cc-cat-1)",
};

const MEDIA_LABEL: Record<PlatformInsights["platform"], string> = {
  TIKTOK: "videos",
  INSTAGRAM: "posts",
  YOUTUBE: "videos",
  FACEBOOK: "posts",
  THREADS: "posts",
};

const PROFILE_LINK_LABEL: Record<PlatformInsights["platform"], string> = {
  TIKTOK: "Open on TikTok",
  INSTAGRAM: "Open on Instagram",
  YOUTUBE: "Open on YouTube",
  FACEBOOK: "Open on Facebook",
  THREADS: "Open on Threads",
};

/** A Facebook Page with no username is stored under its name, which is not an @handle. */
export function atHandle(handle: string): string {
  return handle.startsWith("@") || /\s/.test(handle) ? handle : `@${handle}`;
}

export function followerWord(platform: string): string {
  return platform === "YOUTUBE" ? "subscribers" : "followers";
}

/** The account's picture. Platform avatar URLs are signed and expire (TikTok's
    within days), so a dead one falls back to the name's first letter instead
    of a broken image. */
function Avatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size, borderRadius: "50%", flexShrink: 0 } as const;
  if (src && !broken) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={src} alt="" width={size} height={size} onError={() => setBroken(true)} style={{ ...box, objectFit: "cover", background: "var(--cc-hover-bg)", display: "block" }} />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        ...box,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--cc-hover-bg)",
        fontSize: Math.round(size * 0.38),
        fontWeight: 700,
        color: "var(--cc-text-muted)",
      }}
    >
      {name.replace(/^@/, "").charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** The picture with the platform's mark on its corner, so the account reads
    as "Mia on TikTok" before any text is read. */
function AccountAvatar({ block, size }: { block: PlatformInsights; size: number }) {
  const badge = Math.round(size * 0.4);
  const handle = atHandle(block.handle);
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, flexShrink: 0 }}>
      <Avatar src={block.avatarUrl} name={block.displayName?.trim() || handle} size={size} />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: -2,
          bottom: -2,
          width: badge,
          height: badge,
          borderRadius: "50%",
          background: "var(--cc-card)",
          boxShadow: "0 0 0 2px var(--cc-card)",
          color: PLATFORM_HUE[block.platform],
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round(badge * 0.62),
        }}
      >
        <PlatformGlyph platform={block.platform} size="1em" />
      </span>
    </span>
  );
}

/**
 * The creator's accounts as tabs: the platform's mark, the handle, and the
 * figure the account leads with, or that it needs reconnecting. Arrow keys
 * move between them (the WAI-ARIA tabs pattern, selection follows focus).
 */
export function AccountSwitcher({
  blocks,
  selected,
  onSelect,
}: {
  blocks: PlatformInsights[];
  selected: string;
  onSelect: (accountId: string) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = blocks.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i === last ? 0 : i + 1)
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i === 0 ? last : i - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(blocks[next].accountId);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label="Your accounts" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
      {blocks.map((b, i) => {
        const on = b.accountId === selected;
        return (
          <button
            key={b.accountId}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`stats-tab-${b.accountId}`}
            aria-selected={on}
            aria-controls={`stats-panel-${b.accountId}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(b.accountId)}
            onKeyDown={(e) => onKey(e, i)}
            className="rsp-touch focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              font: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              maxWidth: "100%",
              padding: "7px 14px 7px 10px",
              borderRadius: 999,
              border: `1px solid ${on ? "var(--cc-primary)" : "var(--cc-border)"}`,
              background: on ? "var(--cc-primary)" : "var(--cc-card)",
              color: on ? "var(--cc-on-primary)" : "var(--cc-text)",
              cursor: "pointer",
              fontSize: 14,
              outlineColor: "var(--cc-primary)",
              transition: "background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out",
            }}
          >
            <span aria-hidden="true" style={{ display: "inline-flex", color: on ? "var(--cc-on-primary)" : PLATFORM_HUE[b.platform], fontSize: 16 }}>
              <PlatformGlyph platform={b.platform} size="1em" />
            </span>
            <span className="sr-only">{platformLabel(b.platform)} </span>
            <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{atHandle(b.handle)}</span>
            {b.needsReconnect ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", opacity: on ? 0.9 : 1 }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cc-warning)" }} />
                Reconnect
              </span>
            ) : (
              typeof b.followers === "number" && (
                <span style={{ ...NUM, fontSize: 13, whiteSpace: "nowrap", color: on ? "var(--cc-on-primary)" : "var(--cc-text-muted)", opacity: on ? 0.8 : 1 }}>
                  {formatCount(b.followers)}
                  <span className="sr-only"> {followerWord(b.platform)}</span>
                </span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The profile as the platform shows it, with the counts the creator knows
 * from their own profile page. Only the counts the platform returned are
 * shown: a Facebook Page has no following, a Page read has no post count.
 */
export function AccountHero({ block }: { block: PlatformInsights }) {
  const handle = atHandle(block.handle);
  const name = block.displayName?.trim() || handle;
  const counts = (
    [
      [followerWord(block.platform), block.followers],
      ["following", block.following],
      ["likes", block.totalLikes],
      [MEDIA_LABEL[block.platform], block.mediaCount],
    ] as Array<[string, number | null]>
  ).filter((row): row is [string, number] => typeof row[1] === "number");

  return (
    <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "16px 20px" }}>
      <AccountAvatar block={block} size={76} />
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 22, fontWeight: 700, color: "var(--cc-text)", margin: 0, lineHeight: 1.25, overflowWrap: "anywhere" }}>
          {name}
          {block.isVerified && <BadgeCheck size={20} aria-label="Verified" role="img" style={{ color: "var(--cc-info)", flexShrink: 0 }} />}
        </h2>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: "2px 0 0", overflowWrap: "anywhere" }}>
          {name === handle ? platformLabel(block.platform) : `${handle} · ${platformLabel(block.platform)}`}
        </p>
        {!block.needsReconnect && counts.length > 0 && (
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
            {counts.map(([label, value]) => (
              <li key={label} style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
                <strong style={{ ...NUM, fontWeight: 700, color: "var(--cc-text)", fontSize: 16 }}>{formatCount(value)}</strong> {label}
              </li>
            ))}
          </ul>
        )}
        {block.bio?.trim() && (
          <p
            style={{
              fontSize: 14,
              color: "var(--cc-text)",
              lineHeight: 1.5,
              maxWidth: "62ch",
              margin: "10px 0 0",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {block.bio.trim()}
          </p>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>
        {block.needsReconnect ? (
          <StatusPill tone="warning">Reconnect needed</StatusPill>
        ) : (
          block.profileUrl && (
            <a
              href={block.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="rsp-touch"
              style={{ ...secondaryButtonStyle, minHeight: 34, padding: "6px 12px", fontSize: 13 }}
            >
              {PROFILE_LINK_LABEL[block.platform]}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          )
        )}
      </div>
    </header>
  );
}
