"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { X } from "lucide-react";
import { Banner as DsBanner } from "@/components/ds/Banner";
import { PageHeader, type PageHeaderBack } from "@/components/ds/PageHeader";
import { Skeleton } from "@/components/ds/Skeleton";
import { StatusBadge } from "@/components/ds/StatusBadge";

/**
 * The creator app's building blocks.
 *
 * Phone first: every screen is one column at 390px and simply gets more room on
 * a desktop, rather than a desktop table squeezed onto a phone. Colours come
 * from the --cc-* tokens only, so light and dark restyle these without a
 * branch. Tap targets reach 44px on phones through the existing `rsp-touch`
 * rule in globals.css, which applies below 768px only, so the same controls
 * stay compact on a desktop.
 */

export { platformLabel } from "@/lib/format";

export function formatCount(n: number | null | undefined): string {
  return formatExact(n);
}

export function formatExact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function formatDay(iso: string | null | undefined, opts: { utc?: boolean } = {}): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  /* `utc` for a stored calendar day (a campaign's launch), so it reads as the
     day the agency picked in every timezone. */
  const year = (x: Date) => (opts.utc ? x.getUTCFullYear() : x.getFullYear());
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: year(d) === year(new Date()) ? undefined : "numeric",
    ...(opts.utc ? { timeZone: "UTC" } : {}),
  });
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
  badges,
  back,
  children,
  maxWidth = 760,
  hero,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Buttons only; a status goes in `badges`. */
  action?: ReactNode;
  /** Status badges on the title's line. */
  badges?: ReactNode;
  /** A detail screen's way back to its parent. */
  back?: PageHeaderBack;
  children: ReactNode;
  /** A screen of dashboards (My stats) takes the desktop's width; the rest read as one column. */
  maxWidth?: number;
  /** Replaces the plain page header with the screen's own (a campaign's cover). */
  hero?: ReactNode;
}) {
  return (
    <main style={{ maxWidth, margin: "0 auto", padding: "20px 16px 24px" }}>
      {hero ?? <PageHeader title={title} subtitle={subtitle} actions={action} badges={badges} back={back} />}
      {children}
    </main>
  );
}

/** `flush` drops the inset for a card whose rows run edge to edge and pad themselves. */
export function Card({ children, style, flush = false }: { children: ReactNode; style?: CSSProperties; flush?: boolean }) {
  return (
    <section
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: "var(--cc-r-card)",
        padding: flush ? 0 : "var(--cc-card-inset)",
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
  minHeight: "var(--cc-control-h)",
  padding: "0 14px",
  borderRadius: "var(--cc-r-control)",
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
        borderRadius: "var(--cc-r-card)",
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

/** A status chip: the app's StatusBadge, with the dot the creator app's screens all show. */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <StatusBadge tone={tone} dot>
      {children}
    </StatusBadge>
  );
}

export function Banner({ tone, children, onDismiss }: { tone: "success" | "danger" | "info"; children: ReactNode; onDismiss?: () => void }) {
  return (
    <DsBanner
      tone={tone}
      role={tone === "danger" ? "alert" : "status"}
      style={{ marginBottom: 16 }}
      action={
        onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rsp-touch"
            style={{ display: "inline-flex", background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 2 }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : undefined
      }
    >
      {children}
    </DsBanner>
  );
}

export function SkeletonBlock({ height = 72 }: { height?: number }) {
  return <Skeleton height={height} radius="var(--cc-r-card)" />;
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
