"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { formatDateAbs } from "@/lib/format";
import type { InstagramFallbackHealth, InstagramSourceHealth } from "@/lib/integrations/health";

/** How close to expiry a working credential has to be before it is worth
 *  interrupting someone. The refresher starts trying at 14 days out, so 7 means
 *  roughly a week of daily attempts have already failed by the time this shows. */
const EARLY_WARNING_DAYS = 7;

/**
 * "Instagram numbers are not refreshing."
 *
 * When INSTAGRAM_BUSINESS_TOKEN dies, Business Discovery -- the only source of
 * Instagram *views* -- goes with it, and lib/platforms/fetchPostMetrics quietly
 * falls through to the public embed. No post fails, no sync errors, and the
 * columns simply stop moving. This is the part a person can see.
 *
 * How much the embed still catches is now read off a probe rather than written
 * into the sentence. Until 2026-09-17 all three failure branches here ended
 * "Likes and comments still update." -- true when written, and false by the time
 * a client would have read it: 150 production Instagram posts were re-read over
 * 7 days and not one like count moved, because the embed stopped serving post
 * data. A banner whose job is to say the numbers stopped must not be the thing
 * asserting that some of them didn't.
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
  /* Null means "nobody checked", which is a third answer and not a synonym for
     "closed": the route only probes the fallback once the official source is
     down, and only when the org has an Instagram post to probe with. */
  const [fallback, setFallback] = useState<InstagramFallbackHealth | null>(null);

  useEffect(() => {
    let live = true;
    apiFetch<{ instagram: InstagramSourceHealth; instagramFallback?: InstagramFallbackHealth | null }>(
      "/api/admin/integration-health",
    )
      .then((res) => {
        if (!live) return;
        setHealth(res.instagram);
        setFallback(res.instagramFallback ?? null);
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

  /* The three sentences are assembled rather than written out per branch,
     because the cause and what is still arriving are independent facts and
     writing them together is what let a stale claim ride along inside five
     otherwise-correct sentences. */
  const cause = notConfigured
    ? "no Instagram data connection is set up, so view counts are never collected"
    : unreachable
      ? `we could not reach Instagram when we checked on ${checked}, so views may be behind`
      : `the Instagram data connection was refused when we checked on ${checked} (${health.reason})`;

  const still =
    fallback === null
      ? "Likes and comments keep updating only for creators who connected their own Instagram account."
      : fallback.serving
        ? "Likes and comments still update."
        : `Likes and comments have stopped too — ${fallback.reason}, so only creators who connected their own Instagram account are still measured.`;

  const remedy = notConfigured
    ? ""
    : unreachable
      ? " This usually clears on its own."
      : " Ask your admin to reconnect.";

  /* "views" would understate it once the fallback is gone: at that point every
     Instagram figure on the page is frozen, not just the view column. */
  const subject = fallback && !fallback.serving ? "numbers" : "views";
  const headline = unreachable
    ? `Instagram ${subject} may be out of date`
    : `Instagram ${subject} are not refreshing`;

  return <Banner headline={headline} detail={`${cause}. ${still}${remedy}`} style={style} />;
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
