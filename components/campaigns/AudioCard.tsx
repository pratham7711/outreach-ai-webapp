"use client";
import React, { useState } from "react";
import { Card } from "@pratham7711/ui";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import { Music2 } from "lucide-react";
import { formatCompact } from "@/lib/format";
import { imgSrc, shareImgSrc } from "@/lib/postMedia";
import type { CampaignAudio } from "@/lib/reports/campaignPerformance";

/**
 * The sound behind the campaign: cover, title, artist, how many videos use it,
 * how many were added in the last day, and the usage curve.
 *
 * Shared by the campaign's own Performance tab and the public share report,
 * because CreatorCore shows the same card in both places and a second copy
 * would drift. Nothing here is gated on the share visibility flags — the
 * reference report shows the audio unconditionally, and the card carries no
 * creator names, money, or anything else a link can withhold.
 */
/**
 * A run of syncs taken minutes apart all fall on one date, and an axis of
 * identical dates tells the reader nothing. When every reading shares a day the
 * axis shows the clock instead.
 */
function makeAxisLabel(series: CampaignAudio["usageSeries"]) {
  /* UTC on both, because `at` is a UTC instant and `days` above is counted off
     its UTC date. Reading it back in the viewer's zone would put a label on a
     point that the bucketing beside it disagrees with, and would differ between
     the server render and the browser's. */
  const days = new Set(series.map((p) => p.at.slice(0, 10)));
  if (days.size <= 1) {
    return (v: string) =>
      new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  }
  return (v: string) =>
    new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function AudioCard({ audio, shareToken }: { audio: CampaignAudio; shareToken?: string }) {
  const axisLabel = makeAxisLabel(audio.usageSeries);
  /*
    Which proxy depends on who is looking. /api/img is session-gated -- it has to
    be, or it is bandwidth anyone can spend -- so the public client report passes
    its share token and the request goes through the token-scoped twin instead.
    Either way it is proxied rather than hotlinked: the cover arrives for a viewer
    whose own network cannot reach the platform's CDN, which is the normal case on
    some ISPs, and a HEIC cover gets transcoded on the way.
  */
  const [coverBroken, setCoverBroken] = useState(false);
  const cover = coverBroken
    ? null
    : shareToken
      ? shareImgSrc(shareToken, audio.coverUrl, 88)
      : imgSrc(audio.coverUrl, 88);
  // A tracked sound has counts only after a sync. Zero would claim the audio has
  // never been used, so an unsynced tracker shows an em dash instead.
  const uses = audio.uses === null ? "—" : formatCompact(audio.uses);
  const added = audio.videosAdded24h === null ? "—" : `+${formatCompact(audio.videosAdded24h)}`;

  /* Usage is how many videos use the sound; Velocity is how fast that is moving.
     CreatorCore puts both behind this toggle over one chart, and they are two
     questions about the same series rather than two datasets. */
  const [view, setView] = useState<"usage" | "velocity">("usage");

  return (
    <Card>
      <div style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Music2 size={16} style={{ color: "var(--cc-text-muted)" }} aria-hidden="true" />
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>TikTok Audio</span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: audio.usageSeries.length > 1 ? 20 : 0 }}>
          <a
            href={audio.soundUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 12, flex: "1 1 240px", minWidth: 0,
              padding: 12, borderRadius: 12, border: "1px solid var(--cc-border)",
              background: "var(--cc-bg)", textDecoration: "none",
            }}
          >
            {cover ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={cover}
                alt=""
                onError={() => setCoverBroken(true)}
                style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
              />
            ) : (
              <div
                aria-hidden="true"
                style={{
                  width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--cc-card)", border: "1px solid var(--cc-border)",
                }}
              >
                <Music2 size={18} style={{ color: "var(--cc-text-subtle)" }} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14, fontWeight: 600, color: "var(--cc-text)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {audio.title}
              </div>
              <div
                style={{
                  fontSize: 13, color: "var(--cc-text-muted)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {audio.artist}
              </div>
            </div>
          </a>

          <Stat label="Audio Uses" value={uses} />
          {/* Not "(24h)": a snapshot is taken whenever a sync runs, so the delta
              is between the last two readings and calling that a day would be a
              claim about a cadence we do not keep. CreatorCore's own label reads
              "Videos Added (Since..." -- truncated in their markup, not by CSS --
              so there is no exact string to match here. */}
          <Stat label="Videos Added (Since Last Sync)" value={added} />
        </div>

        {/* One point is not a curve; the chart appears once there are two. */}
        {audio.usageSeries.length > 1 ? (
          <div style={{ height: 210 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>Audio Usage</span>
              <div role="tablist" aria-label="Audio chart view" style={{ display: "flex", gap: 4 }}>
                {(["usage", "velocity"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    onClick={() => setView(key)}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999,
                      cursor: "pointer", textTransform: "capitalize",
                      border: `1px solid ${view === key ? "var(--cc-primary)" : "var(--cc-border)"}`,
                      background: view === key ? "var(--cc-primary)" : "var(--cc-card)",
                      color: view === key ? "white" : "var(--cc-text-muted)",
                    }}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height="82%">
              <AreaChart data={audio.usageSeries} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <XAxis
                  dataKey="at"
                  tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={axisLabel}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  /* Velocity is a signed percentage and has to be allowed below
                     zero. Recharts defaults a numeric axis to [0, 'auto'], so
                     the view that exists to show a sound losing pace was the
                     one view that could not draw it -- a reading of -2.17% sat
                     clipped on the floor. Usage keeps the zero baseline, which
                     for a count is what you want. */
                  domain={view === "velocity" ? ["auto", "auto"] : [0, "auto"]}
                  allowDecimals={view === "velocity"}
                  tickFormatter={(v) => (view === "velocity" ? `${Number(v).toFixed(0)}%` : formatCompact(Number(v)))}
                />
                <Tooltip
                  formatter={(v) => (view === "velocity" ? `${Number(v).toFixed(2)}%` : formatCompact(Number(v)))}
                  labelFormatter={(v) =>
                    new Date(String(v)).toLocaleString("en-GB", {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })
                  }
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Area
                  type="monotone"
                  dataKey={view === "velocity" ? "velocity" : "uses"}
                  stroke="var(--cc-primary)"
                  fill="var(--cc-primary)"
                  fillOpacity={0.14}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
            Usage over time appears once this sound has been synced more than once.
          </p>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: "0 1 150px", padding: 12, borderRadius: 12,
        border: "1px solid var(--cc-border)", background: "var(--cc-bg)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{value}</div>
    </div>
  );
}
