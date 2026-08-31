"use client";
import { Hammer, Lock, AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Three states that are routinely collapsed into one "coming soon", and must not be.
 *
 * They differ in who can act and what happens next:
 *   not-built   nobody can do anything; the answer is "wait"
 *   locked      an administrator can act; the answer is "upgrade or ask"
 *   degraded    we are already acting; the answer is "it will fix itself"
 *
 * A user told "coming soon" for something that is actually an outage will not
 * report it. One told "coming soon" for something their plan could unlock will
 * not buy it. Conflating them costs a bug report and a sale respectively, so
 * each gets its own icon, its own accent token and its own verb.
 *
 * A note on the locked variant: it takes an `action` rather than assuming a
 * Billing link, because the audit found lock screens telling users to "enable
 * it in Billing" when nothing in the app can write org features. Never point a
 * lock at a door with no handle — if there is no way to self-serve, the honest
 * action is "contact support".
 */

export type FeatureStateKind = "not-built" | "locked" | "degraded";

const PRESET: Record<
  FeatureStateKind,
  { icon: ReactNode; accent: string; tint: string }
> = {
  "not-built": { icon: <Hammer size={20} />, accent: "var(--cc-primary)", tint: "var(--cc-primary-light)" },
  locked: { icon: <Lock size={20} />, accent: "var(--cc-warning)", tint: "var(--cc-card)" },
  degraded: { icon: <AlertTriangle size={20} />, accent: "var(--cc-warning)", tint: "var(--cc-card)" },
};

export function FeatureState({
  kind,
  title,
  body,
  action,
  footnote,
}: {
  kind: FeatureStateKind;
  title: string;
  body: string;
  action?: ReactNode;
  footnote?: string;
}) {
  const p = PRESET[kind];
  return (
    <div
      role={kind === "degraded" ? "status" : undefined}
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderLeft: kind === "not-built" ? "1px solid var(--cc-border)" : `3px solid ${p.accent}`,
        borderRadius: 12,
        padding: 24,
        maxWidth: 620,
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: p.tint, color: p.accent,
          border: kind === "not-built" ? "none" : `1px solid ${p.accent}`,
        }}
      >
        {p.icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
          {title}
        </h2>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: action ? 16 : 0 }}>
          {body}
        </p>
        {action}
        {footnote ? (
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 12 }}>{footnote}</p>
        ) : null}
      </div>
    </div>
  );
}

/** The wording for a feature that does not exist yet. Says so plainly: the
 *  worst version of this screen is one that implies the user did something
 *  wrong, or that the data is missing rather than the feature. */
export function ComingSoon({
  feature,
  note,
}: {
  feature: string;
  note?: string;
}) {
  return (
    <FeatureState
      kind="not-built"
      title={`${feature} is coming soon`}
      body={`We're still building ${feature}. Nothing here is broken or hidden from you — it just hasn't shipped yet.`}
      footnote={note}
    />
  );
}
