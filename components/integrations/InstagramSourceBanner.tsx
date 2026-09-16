"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { formatDateAbs } from "@/lib/format";
import type { InstagramSourceHealth } from "@/lib/integrations/health";

/** How close to expiry a working credential has to be before it is worth
 *  interrupting someone. The refresher starts trying at 14 days out, so 7 means
 *  roughly a week of daily attempts have already failed by the time this shows. */
const EARLY_WARNING_DAYS = 7;

/**
 * "Instagram views are not refreshing."
 *
 * When INSTAGRAM_BUSINESS_TOKEN dies, Business Discovery -- the only source of
 * Instagram *views* -- goes with it, and lib/platforms/fetchPostMetrics quietly
 * falls through to the public embed, which still carries likes and comments. No
 * post fails, no sync errors, and the view column simply stops moving. This is
 * the part a person can see.
 *
 * Fetched from the client on purpose: the probe is a Graph round trip, and no
 * page here is worth blocking on Meta answering. Nothing renders until the
 * answer arrives, and nothing renders at all when the source is healthy -- a
 * banner that says "all fine" is a banner people learn to scroll past.
 *
 * The one exception is a token that still works but is nearly out of time and
 * is not renewing itself. Saying that a week early is the difference between a
 * calm afternoon and two days of missing views, which is what the incident this
 * module came from actually cost.
 */

export function InstagramSourceBanner({ style }: { style?: React.CSSProperties }) {
  const [health, setHealth] = useState<InstagramSourceHealth | null>(null);

  useEffect(() => {
    let live = true;
    apiFetch<{ instagram: InstagramSourceHealth }>("/api/admin/integration-health")
      .then((res) => {
        if (live) setHealth(res.instagram);
      })
      /* A failed health check is not itself worth shouting about, and shouting
         about it would put a warning on the page every time a session lapsed. */
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!health) return null;

  if (health.ok) {
    const left = health.expiresInDays;
    if (left === null || left > EARLY_WARNING_DAYS) return null;
    return (
      <Banner
        headline={
          left <= 0
            ? "Instagram views stop refreshing today"
            : `Instagram views stop refreshing in ${left} day${left === 1 ? "" : "s"}`
        }
        detail={`the Instagram data connection is close to expiring and has not renewed itself${
          health.renewalError ? ` (${health.renewalError})` : ""
        }. Views are still updating for now. Ask your admin to reconnect.`}
        style={style}
      />
    );
  }

  /* What we actually measured, said as what it is.
   *
   * This used to read "the connection expired on {checkedAt}" for every
   * failure. checkedAt is when the probe ran, not when anything expired --
   * nothing here knows an expiry date, and lib/integrations/health.ts says so
   * in its own comment -- so the banner was printing today's date as the day
   * the credential died. It also flattened three different situations into
   * that one sentence: a token that was never configured, a token Meta
   * rejected, and our own failure to reach Meta at all. Only the middle one is
   * something an admin can go and fix, and health.ts separates them precisely
   * so that nobody is sent to replace a credential that was never asked for. */
  const checked = formatDateAbs(health.checkedAt);
  const notConfigured = health.reason === "not configured";
  const unreachable = health.reason.startsWith("could not reach");

  const headline = unreachable
    ? "Instagram views may be out of date"
    : "Instagram views are not refreshing";

  const detail = notConfigured
    ? "no Instagram data connection is set up, so view counts are never collected. Likes and comments still update."
    : unreachable
      ? `we could not reach Instagram when we checked on ${checked}, so views may be behind. Likes and comments still update. This usually clears on its own.`
      : `the Instagram data connection was refused when we checked on ${checked} (${health.reason}). Likes and comments still update. Ask your admin to reconnect.`;

  return <Banner headline={headline} detail={detail} style={style} />;
}

/** The warning treatment itself. Every branch above differs only in its two
 *  sentences, so the box is written once. */
function Banner({
  headline,
  detail,
  style,
}: {
  headline: string;
  detail: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 10,
        fontSize: "var(--cc-t-13)",
        lineHeight: 1.5,
        // The house warning treatment, same mix as RemovedPostOverlay so all
        // three themes re-colour this with the rest of the palette.
        color: "var(--cc-warning)",
        background: "color-mix(in srgb, var(--cc-warning) 16%, var(--cc-card))",
        border: "1px solid color-mix(in srgb, var(--cc-warning) 45%, transparent)",
        ...style,
      }}
    >
      <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        <strong style={{ fontWeight: 700 }}>{headline}</strong> — {detail}
      </span>
    </div>
  );
}

export default InstagramSourceBanner;
