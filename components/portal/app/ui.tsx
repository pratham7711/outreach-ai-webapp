"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * The creator app's building blocks.
 *
 * Phone first: every screen is one column at 390px and simply gets more room on
 * a desktop, rather than a desktop table squeezed onto a phone. Colours come
 * from the --cc-* tokens only, so the three themes (creatorcore, light, dark)
 * restyle these without a branch. Tap targets reach 44px on phones through the
 * existing `rsp-touch` rule in globals.css, which applies below 768px only, so
 * the same controls stay compact on a desktop.
 */

export const PLATFORM_LABEL: Record<string, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  FACEBOOK: "Facebook",
  THREADS: "Threads",
  TWITTER: "X",
  TWITCH: "Twitch",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform.toUpperCase()] ?? platform;
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** "today", "in 3 days", "2 days ago" -- for the one date a creator acts on. */
export function relativeDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function Screen({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px 24px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", margin: 0, lineHeight: 1.25 }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: "4px 0 0", lineHeight: 1.5 }}>
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 14,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, margin: "0 0 10px" }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{children}</h2>
      {aside}
    </div>
  );
}

/** Where a number came from, under the block that shows it: "From Instagram · insights". */
export function SourceLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "8px 0 0" }}>{children}</p>
  );
}

const linkButtonBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 36,
  padding: "8px 14px",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

export const primaryButtonStyle: CSSProperties = {
  ...linkButtonBase,
  background: "var(--cc-primary)",
  color: "var(--cc-on-primary)",
  border: "1px solid var(--cc-primary)",
};

export const secondaryButtonStyle: CSSProperties = {
  ...linkButtonBase,
  background: "var(--cc-card)",
  color: "var(--cc-text)",
  border: "1px solid var(--cc-border)",
};

/** A link that reads as a button. `external` is for routes that leave the app
 *  (the OAuth start routes), which must be a full navigation, not a client one. */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  external = false,
  style,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  external?: boolean;
  style?: CSSProperties;
}) {
  const s = { ...(variant === "primary" ? primaryButtonStyle : secondaryButtonStyle), ...style };
  if (external) {
    return (
      <a href={href} className="rsp-touch" style={s}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className="rsp-touch" style={s}>
      {children}
    </Link>
  );
}

/**
 * An empty state names the one next step and offers it, nothing else.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: ReactNode;
  action?: { label: string; href: string; external?: boolean };
}) {
  return (
    <div
      style={{
        border: "1px dashed var(--cc-border)",
        borderRadius: 14,
        padding: "24px 16px",
        textAlign: "center",
        background: "var(--cc-card)",
      }}
    >
      <p style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>{title}</p>
      {body && (
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "6px auto 0", maxWidth: 420, lineHeight: 1.5 }}>
          {body}
        </p>
      )}
      {action && (
        <div style={{ marginTop: 14 }}>
          <ButtonLink href={action.href} external={action.external}>
            {action.label}
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_DOT: Record<Tone, string> = {
  success: "var(--cc-success)",
  warning: "var(--cc-warning)",
  danger: "var(--cc-danger)",
  info: "var(--cc-info)",
  neutral: "var(--cc-text-muted)",
};

/**
 * A status chip. The text stays in --cc-text so it passes contrast in every
 * theme; the tone is carried by the dot and the border, never by low-contrast
 * coloured text.
 */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--cc-text)",
        border: `1px solid ${TONE_DOT[tone]}`,
        borderRadius: 999,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: TONE_DOT[tone] }} />
      {children}
    </span>
  );
}

export function Banner({ tone, children, onDismiss }: { tone: "success" | "danger" | "info"; children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 14px",
        marginBottom: 16,
        borderRadius: 12,
        border: `1px solid ${TONE_DOT[tone]}`,
        background: "var(--cc-card)",
        fontSize: 14,
        color: "var(--cc-text)",
        lineHeight: 1.5,
      }}
    >
      <span style={{ flex: 1 }}>{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rsp-touch"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function SkeletonBlock({ height = 72 }: { height?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        height,
        borderRadius: 14,
        background: "var(--cc-hover-bg)",
        border: "1px solid var(--cc-border)",
      }}
    />
  );
}

export function LoadFailed({ onRetry, what }: { onRetry: () => void; what: string }) {
  return (
    <Banner tone="danger">
      Couldn&apos;t load {what}.{" "}
      <button
        type="button"
        onClick={onRetry}
        className="rsp-touch"
        style={{ background: "none", border: "none", padding: 0, color: "var(--cc-primary)", fontWeight: 600, cursor: "pointer", fontSize: 14 }}
      >
        Try again
      </button>
    </Banner>
  );
}
