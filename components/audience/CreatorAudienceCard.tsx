"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { SectionHeading, Toggle, muted } from "@/components/insights/parts";
import type { StoredAudience } from "@/lib/creators/audienceSnapshots";
import { emptyMix } from "@/lib/platforms/instagramAccountInsights";
import { AudienceBreakdowns, toShares } from "./AudienceBreakdowns";

/**
 * A creator's Instagram audience as saved by the weekly read: who follows
 * them, and who engaged with them this week or this month, each on a globe
 * with its breakdowns. Draws nothing for a creator who has not connected
 * Instagram, the same as the insights panel below it.
 */

type Body = {
  ready: boolean;
  connection: "none" | "instagram_login" | "facebook_login";
  audiences: StoredAudience[];
};

type View = "followers" | "engaged_week" | "engaged_month";

const VIEWS: Array<{ value: View; label: string; audience: StoredAudience["audience"]; timeframe: StoredAudience["timeframe"]; who: string; note: string }> = [
  { value: "followers", label: "Followers", audience: "followers", timeframe: "this_month", who: "Followers", note: "Everyone who follows this account." },
  {
    value: "engaged_week",
    label: "Engaged this week",
    audience: "engaged",
    timeframe: "this_week",
    who: "Engaged audience",
    note: "People who liked, commented, saved or shared in the 7 days before the reading, followers or not.",
  },
  {
    value: "engaged_month",
    label: "Engaged this month",
    audience: "engaged",
    timeframe: "this_month",
    who: "Engaged audience",
    note: "People who liked, commented, saved or shared in the 30 days before the reading, followers or not.",
  },
];

const formatDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function CreatorAudienceCard({ creatorId }: { creatorId: string }) {
  const headingId = useId();
  const [state, setState] = useState<{ status: "loading" } | { status: "failed" } | { status: "ok"; body: Body }>({ status: "loading" });
  const [view, setView] = useState<View>("followers");

  useEffect(() => {
    let alive = true;
    fetch(`/api/creators/${encodeURIComponent(creatorId)}/audience`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Body>) : Promise.reject(new Error(String(r.status)))))
      .then((body) => alive && setState({ status: "ok", body }))
      .catch(() => alive && setState({ status: "failed" }));
    return () => {
      alive = false;
    };
  }, [creatorId]);

  const body = state.status === "ok" ? state.body : null;
  const available = useMemo(
    () => VIEWS.filter((v) => body?.audiences.some((a) => a.audience === v.audience && a.timeframe === v.timeframe && !emptyMix(a.mix))),
    [body],
  );
  const chosen = available.find((v) => v.value === view) ?? available[0];
  const reading = chosen && body?.audiences.find((a) => a.audience === chosen.audience && a.timeframe === chosen.timeframe);
  const shares = useMemo(
    () =>
      reading
        ? { country: toShares(reading.mix.country), city: toShares(reading.mix.city), age: toShares(reading.mix.age), gender: toShares(reading.mix.gender) }
        : null,
    [reading],
  );

  /* Nothing until the read answers, so a creator with no audience never flashes a card. */
  if (state.status === "loading") return null;
  if (state.status === "failed" || !body || !body.ready) return null;
  if (body.connection === "none" && body.audiences.length === 0) return null;

  const lastRead = body.audiences.reduce<string | null>((a, r) => (!a || r.day > a ? r.day : a), null);

  return (
    <section style={card} aria-labelledby={headingId} data-testid="creator-audience">
      <SectionHeading
        id={headingId}
        level={2}
        title="Audience"
        aside={lastRead ? `Read from Instagram on ${formatDay(lastRead)}` : undefined}
      />
      {available.length === 0 ? (
        <p style={muted}>
          {body.connection === "instagram_login"
            ? "Connected with Instagram Login, which does not share audience. Reconnecting through Facebook adds it."
            : lastRead
              ? "Instagram shares an account's audience once it has 100 followers. It is asked again every week."
              : "Read once a week; the first reading lands within the hour."}
        </p>
      ) : (
        <>
          {available.length > 1 && (
            <div style={{ marginBottom: 18 }}>
              <Toggle label="Which audience" options={available.map((v) => ({ value: v.value, label: v.label }))} value={chosen!.value} onChange={setView} />
            </div>
          )}
          {shares && <AudienceBreakdowns shares={shares} who={chosen!.who} />}
          <p style={{ ...muted, fontSize: 12, marginTop: 18 }}>
            {chosen!.note} Instagram lists the top 45 countries and cities and leaves out people it has no data for.
          </p>
        </>
      )}
    </section>
  );
}

const card = {
  background: "var(--cc-card)",
  border: "1px solid var(--cc-border)",
  borderRadius: 12,
  padding: 24,
  marginTop: 16,
} as const;
