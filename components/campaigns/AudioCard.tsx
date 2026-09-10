"use client";
import React, { useState } from "react";
import { Card } from "@pratham7711/ui";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import { Music2 } from "lucide-react";
import { formatCompact, formatFull, fitFigureSize } from "@/lib/format";
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

/**
 * `report` is the public client link's skin, measured off CreatorCore's own
 * client report rather than off our dashboard: a grey sound tile beside two
 * black stat tiles, a plain-text Usage/Velocity toggle above a centred chart
 * title, and a flat grey area under a black line.
 *
 * A second render branch rather than another dozen CSS custom properties,
 * because the two differ in ORDER as well as colour -- the reference puts the
 * toggle above the title and centres it, which no token can express -- and
 * because branching keeps the dashboard's markup literally untouched.
 */
export type AudioCardVariant = "dashboard" | "report";

/**
 * The report skin dates its axis the way the reference does -- `9/03/26`, month
 * unpadded and day padded -- rather than the dashboard's "3 Sept". Same UTC
 * reasoning as makeAxisLabel above: `at` is a UTC instant, and reading it in
 * the viewer's zone would put a label on a point the bucketing disagrees with
 * and would differ between the server render and the browser's.
 */
function makeReportAxisLabel(series: CampaignAudio["usageSeries"]) {
  const days = new Set(series.map((p) => p.at.slice(0, 10)));
  if (days.size <= 1) {
    return (v: string) =>
      new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  }
  return (v: string) => {
    const d = new Date(v);
    const month = d.getUTCMonth() + 1;
    const day = String(d.getUTCDate()).padStart(2, "0");
    const year = String(d.getUTCFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
  };
}

export function AudioCard({
  audio,
  shareToken,
  variant = "dashboard",
}: {
  audio: CampaignAudio;
  shareToken?: string;
  variant?: AudioCardVariant;
}) {
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
  // 2x the rendered box on each skin, so the art is not soft on a retina screen.
  const coverPx = variant === "report" ? 124 : 88;
  const cover = coverBroken
    ? null
    : shareToken
      ? shareImgSrc(shareToken, audio.coverUrl, coverPx)
      : imgSrc(audio.coverUrl, coverPx);
  // A tracked sound has counts only after a sync. Zero would claim the audio has
  // never been used, so an unsynced tracker shows an em dash instead.
  const uses = audio.uses === null ? "—" : formatFull(audio.uses);
  const added = audio.videosAdded24h === null ? "—" : `+${formatFull(audio.videosAdded24h)}`;

  /* Usage is how many videos use the sound; Velocity is how fast that is moving.
     CreatorCore puts both behind this toggle over one chart, and they are two
     questions about the same series rather than two datasets. */
  const [view, setView] = useState<"usage" | "velocity">("usage");

  if (variant === "report") {
    return (
      <ReportAudio
        audio={audio}
        cover={cover}
        onCoverError={() => setCoverBroken(true)}
        uses={uses}
        added={added}
        view={view}
        setView={setView}
        axisLabel={makeReportAxisLabel(audio.usageSeries)}
      />
    );
  }

  return (
    <Card>
      <div style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Music2 size={16} style={{ color: "var(--audio-title-ink, var(--cc-text-muted))" }} aria-hidden="true" />
          <span style={{ fontSize: "var(--audio-title-size, 15px)", fontWeight: 700, color: "var(--audio-title-ink, var(--cc-text))" }}>TikTok Audio</span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: audio.usageSeries.length > 1 ? 20 : 0 }}>
          <a
            href={audio.soundUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 12, flex: "1 1 240px", minWidth: 0,
              padding: 12, borderRadius: "var(--audio-tile-radius, 12px)",
              border: "1px solid var(--audio-tile-border, var(--cc-border))",
              background: "var(--audio-tile-bg, var(--cc-bg))", textDecoration: "none",
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
                  background: "var(--audio-tile-fill, var(--cc-card))",
                  border: "1px solid var(--audio-tile-border, var(--cc-border))",
                }}
              >
                <Music2 size={18} style={{ color: "var(--audio-tile-ink-muted, var(--cc-text-subtle))" }} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14, fontWeight: 600, color: "var(--audio-tile-ink, var(--cc-text))",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {audio.title}
              </div>
              <div
                style={{
                  fontSize: 13, color: "var(--audio-tile-ink-muted, var(--cc-text-muted))",
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
                  formatter={(v) => (view === "velocity" ? `${Number(v).toFixed(2)}%` : formatFull(Number(v)))}
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
        flex: "0 1 150px", padding: 12, borderRadius: "var(--audio-tile-radius, 12px)",
        border: "1px solid var(--audio-tile-border, var(--cc-border))",
        background: "var(--audio-tile-bg, var(--cc-bg))",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--audio-tile-ink-muted, var(--cc-text-muted))", marginBottom: 4 }}>{label}</div>
      <div title={String(value)} style={{ fontSize: fitFigureSize(String(value), 20), fontWeight: 700, color: "var(--audio-tile-ink, var(--cc-text))", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}

/**
 * The client report's audio card.
 *
 * Every number below is measured off
 * https://lkay.creatorcore.co/client/jamie-macdonald-roots-7258461 at 1440,
 * where the card is 635 wide with 20px padding: tiles 88 tall on a 10px gap at
 * radius 20, the sound tile #848484 against two black stat tiles, and a 250px
 * chart whose area is a flat #7F7F7F under a black line. Colours live in
 * globals.css as --spr-audio-*; the layout lives here.
 */
function ReportAudio({
  audio,
  cover,
  onCoverError,
  uses,
  added,
  view,
  setView,
  axisLabel,
}: {
  audio: CampaignAudio;
  cover: string | null;
  onCoverError: () => void;
  uses: string;
  added: string;
  view: "usage" | "velocity";
  setView: (v: "usage" | "velocity") => void;
  axisLabel: (v: string) => string;
}) {
  const hasCurve = audio.usageSeries.length > 1;

  return (
    <section className="spr-card spr-audio">
      <h2 className="spr-section">TikTok Audio</h2>

      <div className="spr-audio-tiles">
        <a
          className="spr-audio-sound"
          href={audio.soundUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {cover ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="spr-audio-cover" src={cover} alt="" onError={onCoverError} />
          ) : (
            <span className="spr-audio-cover spr-audio-cover-fallback" aria-hidden="true">
              <Music2 size={22} />
            </span>
          )}
          <span className="spr-audio-names">
            <span className="spr-audio-track">{audio.title}</span>
            <span className="spr-audio-artist">{audio.artist}</span>
          </span>
        </a>

        <div className="spr-audio-stat">
          <span className="spr-audio-stat-label">Audio Uses</span>
          <span className="spr-audio-stat-value" title={uses}>
            {uses}
          </span>
        </div>
        {/* The reference labels this "Videos Added". Ours is the change since the
            previous reading rather than a fixed day, which is the same thing the
            reference shows and the same thing recordSoundSnapshot writes. */}
        <div className="spr-audio-stat">
          <span className="spr-audio-stat-label">Videos Added</span>
          <span className="spr-audio-stat-value" title={added}>
            {added}
          </span>
        </div>
      </div>

      {hasCurve ? (
        <>
          {/* Toggle above the title, plain text, the active one underlined --
              the reference's order, which is why this is a branch and not a
              set of custom properties. */}
          <div className="spr-audio-plot">
          <div className="spr-audio-toggle" role="tablist" aria-label="Audio chart view">
            {(["usage", "velocity"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                className={`spr-audio-tab${view === key ? " is-on" : ""}`}
                onClick={() => setView(key)}
              >
                {key === "usage" ? "Usage" : "Velocity"}
              </button>
            ))}
          </div>

          <h3 className="spr-audio-chart-title">
            {view === "usage" ? "Audio Usage" : "Audio Velocity"}
          </h3>

          <div className="spr-audio-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={audio.usageSeries} margin={{ top: 4, right: 30, left: -8, bottom: 0 }}>
                <XAxis
                  dataKey="at"
                  tick={{ fontSize: 14, fill: "var(--spr-audio-axis)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={axisLabel}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fontSize: 14, fill: "var(--spr-audio-axis)" }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  /* Velocity is a signed percentage and has to be allowed below
                     zero; a count keeps its zero baseline. Same reasoning as the
                     dashboard card above. */
                  domain={view === "velocity" ? ["auto", "auto"] : [0, "auto"]}
                  allowDecimals={view === "velocity"}
                  tickFormatter={(v) => (view === "velocity" ? `${Number(v).toFixed(0)}%` : formatCompact(Number(v)))}
                />
                <Tooltip
                  formatter={(v) => (view === "velocity" ? `${Number(v).toFixed(2)}%` : formatFull(Number(v)))}
                  labelFormatter={(v) =>
                    new Date(String(v)).toLocaleString("en-GB", {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })
                  }
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                {/* Flat fill, no gradient and no opacity: the reference's area is
                    a solid #7F7F7F meeting a black line, and a translucent fill
                    over a white card reads several shades lighter than that. */}
                <Area
                  type="monotone"
                  dataKey={view === "velocity" ? "velocity" : "uses"}
                  stroke="var(--spr-audio-line)"
                  fill="var(--spr-audio-area)"
                  fillOpacity={1}
                  strokeWidth={3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          </div>
        </>
      ) : (
        <p className="spr-note">
          Usage over time appears once this sound has been synced more than once.
        </p>
      )}
    </section>
  );
}
