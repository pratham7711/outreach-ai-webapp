"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { formatDateAbs } from "@/lib/format";
import type { InstagramSourceHealth } from "@/lib/integrations/health";

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

  if (!health || health.ok) return null;

  /* checkedAt, not an expiry date: nothing is stored about when the token died,
     and Graph's debug_token needs the app secret, which this route does not
     touch. The honest date is the one we measured -- when we last looked and
     found it down. */
  const when = formatDateAbs(health.checkedAt);

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 10,
        fontSize: 13,
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
        <strong style={{ fontWeight: 700 }}>Instagram views are not refreshing</strong> — the
        Instagram data connection expired on {when}. Likes and comments still update. Ask your
        admin to reconnect.
      </span>
    </div>
  );
}

export default InstagramSourceBanner;
