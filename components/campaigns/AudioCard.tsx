"use client";
import React, { useState } from "react";
import { Card } from "@pratham7711/ui";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, ReferenceLine, XAxis, YAxis, Tooltip } from "recharts";
import { Music2 } from "lucide-react";
import { formatCompact, formatFull, fitFigureSize } from "@/lib/format";
import { imgSrc, shareImgSrc } from "@/lib/postMedia";
import type { CampaignAudio } from "@/lib/reports/campaignPerformance";
import { velocityBars } from "@/app/(dashboard)/trackers/SoundCharts";
import { rangeStartMs, type ChartRange } from "@/lib/charts/seriesMode";
import { launchLabel, launchShortDay, type CampaignLaunch } from "@/lib/campaigns/launch";
import { soundAtLaunch } from "@/lib/sounds/soundAtLaunch";

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
    return (v: number | string) =>
      new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  }
  return (v: number | string) =>
    new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * The tooltip's heading: the reading's own instant, in UTC and saying so. It
 * was the viewer's local time beside axis labels in UTC, so a reading at 20:00
 * UTC sat under "2 Oct" on the axis and read "3 Oct, 01:30" in its tooltip.
 */
function readingInstant(v: number | string): string {
  return `${new Date(v).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  })} UTC`;
}

/**
 * The card's three views of one series: the running count of videos using the
 * sound ("Cumulative"), the videos added in each chart bucket ("Daily", or per
 * 6h / per week at those granularities), and the pace of change ("Velocity").
 */
type AudioView = "usage" | "added" | "velocity";

const ADDED_TAB = { "6hourly": "Per 6h", daily: "Daily", weekly: "Weekly" } as const;
const ADDED_TITLE = { "6hourly": "New Videos per 6 Hours", daily: "New Videos per Day", weekly: "New Videos per Week" } as const;

/**
 * Videos added per bucket, as the trackers page draws them (velocityBars): one
 * slot per bucket, no bar across an empty bucket or at a rounded count. Empty
 * when the payload does not say its bucket (one cached before it did) or when
 * no bucket has a measurable change.
 */
function addedBarsFor(audio: CampaignAudio): { t: number; delta: number | null }[] {
  if (!audio.usageGranularity) return [];
  const bars = velocityBars(
    audio.usageSeries.map((p) => ({ recordedAt: p.at, value: p.uses, rounded: p.rounded })),
    audio.usageGranularity,
  );
  return bars.some((b) => b.delta !== null) ? bars : [];
}

function audioTabs(audio: CampaignAudio, hasAdded: boolean): { key: AudioView; label: string }[] {
  return [
    ...(hasAdded && audio.usageGranularity ? [{ key: "added" as const, label: ADDED_TAB[audio.usageGranularity] }] : []),
    { key: "usage", label: "Cumulative" },
    { key: "velocity", label: "Velocity" },
  ];
}

function audioTitle(audio: CampaignAudio, view: AudioView): string {
  if (view === "added" && audio.usageGranularity) return ADDED_TITLE[audio.usageGranularity];
  return view === "velocity" ? "Audio Velocity" : "Audio Usage";
}

function AddedBars({
  bars,
  axisLabel,
  report,
  launch,
}: {
  bars: { t: number; delta: number | null }[];
  axisLabel: (v: number | string) => string;
  report: boolean;
  launch?: CampaignLaunch | null;
}) {
  const tick = { fontSize: report ? 14 : 11, fill: report ? "var(--spr-audio-axis)" : "var(--cc-text-muted)" };
  return (
    <ResponsiveContainer width="100%" height={report ? "100%" : "82%"}>
      <BarChart data={bars} margin={{ top: 4, right: report ? 30 : 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="t" tick={tick} tickLine={false} axisLine={false} tickFormatter={axisLabel} minTickGap={28} />
        <YAxis tick={tick} tickLine={false} axisLine={false} width="auto" allowDecimals={false} tickFormatter={(v) => formatCompact(Number(v))} />
        {/* Negative bars are real: creators delete videos, and the count is an
            inventory rather than a running total. */}
        <ReferenceLine y={0} stroke={report ? "var(--spr-audio-axis)" : "var(--cc-border)"} strokeOpacity={report ? 0.4 : 1} />
        {/* The bars sit on a category axis, so the marker goes on the bucket
            the launch fell in, not at its exact instant. */}
        {launch ? launchMarker(launch, report, launchBucket(bars, Date.parse(launch.at))) : null}
        <Tooltip
          formatter={(v: unknown) => [
            v === null || v === undefined ? "No reading before" : `${Number(v) > 0 ? "+" : ""}${formatFull(Number(v))}`,
            "Videos added",
          ]}
          labelFormatter={(v) => readingInstant(v as number)}
          labelStyle={{ fontSize: "var(--cc-t-12)" }}
          contentStyle={{ fontSize: "var(--cc-t-12)", borderRadius: 8 }}
        />
        <Bar dataKey="delta" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {bars.map((b, i) => (
            <Cell
              key={i}
              fill={(b.delta ?? 0) < 0 ? "var(--cc-danger)" : report ? "var(--spr-audio-line)" : "var(--cc-primary)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A rounded point is the platform's "74K", and says so in its tooltip; so
 *  does a velocity measured across one. */
function usageTooltipValue(view: "usage" | "velocity") {
  return (v: unknown, _name: unknown, item: { payload?: { rounded?: boolean; velocityApprox?: boolean } } | undefined) =>
    view === "velocity"
      ? `${item?.payload?.velocityApprox ? "≈" : ""}${Number(v).toFixed(2)}%`
      : `${item?.payload?.rounded ? "≈" : ""}${formatFull(Number(v))}`;
}

/* Velocity on a large sound is a fraction of a percent a day, so whole-number
   ticks printed "0%" three times up the axis. Up to two decimals, trailing
   zeros dropped. */
function velocityTick(v: unknown): string {
  return `${parseFloat(Number(v).toFixed(2))}%`;
}

/* An approximate velocity can stand alone between two gaps, and an area needs
   two neighbours to draw anything, so a lone point gets a dot. */
function loneVelocityDot(series: CampaignAudio["usageSeries"], fill: string) {
  return function LoneDot(props: { cx?: number; cy?: number; index?: number }) {
    const i = props.index ?? -1;
    const lone =
      series[i]?.velocity != null && series[i - 1]?.velocity == null && series[i + 1]?.velocity == null;
    if (!lone || props.cx == null || props.cy == null) return <g key={`d${i}`} />;
    return <circle key={`d${i}`} cx={props.cx} cy={props.cy} r={3} fill={fill} />;
  };
}

/** What the Velocity view says when it has nothing to draw, or draws an estimate. */
function velocityNotes(audio: CampaignAudio) {
  const where = audio.platform === "INSTAGRAM" ? "Instagram" : "TikTok";
  return {
    has: audio.usageSeries.some((p) => p.velocity !== null),
    approx: audio.usageSeries.some((p) => p.velocityApprox),
    empty: `No measurable change yet. ${where} shows this sound's count rounded, so velocity appears once the count moves by more than the rounding.`,
    approxNote: `Approximate: ${where} rounds this sound's count, so each change is measured over enough time to be larger than the rounding.`,
  };
}

function shortUtcDay(t: number): string {
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function count(p: { uses: number; rounded: boolean }): string {
  return `${p.rounded ? "≈" : ""}${formatFull(p.uses)}`;
}

/**
 * The sound's count when the campaign launched beside its count now
 * (lib/sounds/soundAtLaunch). A later reading is never passed off as the
 * launch count: without one close enough before the launch, the line says so
 * and names the first reading after it instead.
 */
function launchLine(audio: CampaignAudio, launch: CampaignLaunch | null | undefined): string | null {
  if (!launch) return null;
  const r = soundAtLaunch(audio.usageSeries, Date.parse(launch.at));
  const at = `${launchLabel(launch).toLowerCase()} (${launchShortDay(launch)})`;
  if (!r || r.kind === "none") return null;
  if (r.kind === "atLaunch") {
    const added = r.added === null ? "" : ` (${r.added >= 0 ? "+" : ""}${formatFull(r.added)})`;
    return `${count(r.atLaunch)} videos at the ${at} → ${count(r.now)} now${added}.`;
  }
  return `Not read before the ${at}. First reading after it: ${shortUtcDay(r.firstAfter.t)}, ${count(r.firstAfter)} videos → ${count(r.now)} now.`;
}

/** Why a range shows no curve, when the sound does have one outside it. */
function windowNote(audio: CampaignAudio): string {
  const last = audio.usageSeries.at(-1);
  return `Fewer than two readings in this range.${last ? ` Last reading: ${shortUtcDay(last.t)}.` : ""}`;
}

/** The bucket a launch fell in, or null when it is outside the bars shown. */
function launchBucket(bars: readonly { t: number }[], launchMs: number): number | null {
  if (bars.length < 2 || !Number.isFinite(launchMs)) return null;
  const size = bars[1].t - bars[0].t;
  if (launchMs < bars[0].t || launchMs >= bars[bars.length - 1].t + size) return null;
  return bars.filter((b) => b.t <= launchMs).at(-1)?.t ?? null;
}

/** The launch as a dashed line; recharts drops it outside the range shown. */
function launchMarker(launch: CampaignLaunch | null | undefined, report: boolean, x?: number | null) {
  if (!launch || x === null) return null;
  const ink = report ? "var(--spr-audio-axis)" : "var(--cc-text-muted)";
  return (
    <ReferenceLine
      x={x ?? Date.parse(launch.at)}
      stroke={ink}
      strokeDasharray="4 3"
      label={{ value: launchLabel(launch), position: "insideTopLeft", fontSize: 11, fill: ink }}
    />
  );
}

/**
 * Time-scaled, not categorical. A categorical axis spaces points evenly, so a
 * month of daily readings and one reading a week later were drawn the same
 * distance apart, and five readings taken in one minute spread across the
 * width with one date under all of them.
 */
const TIME_AXIS = { dataKey: "t", type: "number", scale: "time", domain: ["dataMin", "dataMax"] } as const;

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
    return (v: number | string) =>
      new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  }
  return (v: number | string) => {
    const d = new Date(v);
    const month = d.getUTCMonth() + 1;
    const day = String(d.getUTCDate()).padStart(2, "0");
    const year = String(d.getUTCFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
  };
}

export function AudioCard({
  audio: full,
  shareToken,
  variant = "dashboard",
  range = "all",
  launch,
  embedded = false,
}: {
  audio: CampaignAudio;
  shareToken?: string;
  variant?: AudioCardVariant;
  /** How far back the chart looks (lib/charts/seriesMode); the tiles always show the latest. */
  range?: ChartRange;
  /** The campaign's launch, for the marker and the "at launch → now" line. */
  launch?: CampaignLaunch | null;
  /** Inside the campaign's tabbed chart card, whose tab already names the sound. */
  embedded?: boolean;
}) {
  /* The range cuts what the chart draws, after every per-reading figure was
     worked out over the whole series: velocity and the per-bucket bars at the
     window's left edge are still measured from the reading before it. */
  const startMs = rangeStartMs(range);
  const audio = startMs === null ? full : { ...full, usageSeries: full.usageSeries.filter((p) => p.t >= startMs) };
  const outOfRange = startMs !== null && audio.usageSeries.length < 2 && full.usageSeries.length > 1;
  const atLaunch = launchLine(full, launch);
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
  const uses = full.uses === null ? "—" : `${full.usesRounded ? "≈" : ""}${formatFull(full.uses)}`;
  const heading = audio.platform === "INSTAGRAM" ? "Instagram Audio" : "TikTok Audio";
  const added = audio.videosAdded24h === null ? "—" : `+${formatFull(audio.videosAdded24h)}`;

  /* Usage is how many videos use the sound; Velocity is how fast that is moving.
     CreatorCore puts both behind this toggle over one chart, and they are two
     questions about the same series rather than two datasets. */
  const [view, setView] = useState<AudioView>("usage");
  const notes = velocityNotes(audio);
  const allBars = addedBarsFor(full);
  const addedBars = startMs === null ? allBars : allBars.filter((b) => b.t >= startMs);
  const tabs = audioTabs(full, allBars.length > 0);

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
        tabs={tabs}
        addedBars={addedBars}
        fullSeries={full.usageSeries}
        outOfRange={outOfRange}
        atLaunch={atLaunch}
        launch={launch}
      />
    );
  }

  return (
    <EmbedFrame embedded={embedded}>
        {embedded ? null : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Music2 size={16} style={{ color: "var(--audio-title-ink, var(--cc-text-muted))" }} aria-hidden="true" />
          <span style={{ fontSize: "var(--audio-title-size, 15px)", fontWeight: 700, color: "var(--audio-title-ink, var(--cc-text))" }}>{heading}</span>
        </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: full.usageSeries.length > 1 || atLaunch ? 20 : 0 }}>
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
                  fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--audio-tile-ink, var(--cc-text))",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {audio.title}
              </div>
              <div
                style={{
                  fontSize: "var(--cc-t-13)", color: "var(--audio-tile-ink-muted, var(--cc-text-muted))",
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

        {atLaunch ? (
          <p data-testid="sound-at-launch" style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text)", margin: "-8px 0 16px" }}>
            {atLaunch}
          </p>
        ) : null}

        {/* One point is not a curve; the chart appears once there are two. */}
        {outOfRange ? (
          <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>{windowNote(full)}</p>
        ) : audio.usageSeries.length > 1 ? (
          <>
          <div style={{ height: 210 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{audioTitle(audio, view)}</span>
              {/* The same segmented switch as every other chart switch on the
                  page (components/insights/parts Toggle), look and semantics:
                  pressed buttons redrawing one chart, not tabs, which promise
                  a panel per tab. */}
              <div role="group" aria-label="Audio chart view" style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 10, background: "var(--cc-hover-bg)", flexWrap: "wrap" }}>
                {tabs.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                    className="rsp-touch"
                    style={{
                      font: "inherit", fontSize: 13, fontWeight: view === key ? 700 : 500, padding: "5px 11px", borderRadius: 8,
                      cursor: "pointer", border: "none", whiteSpace: "nowrap",
                      background: view === key ? "var(--cc-card)" : "transparent",
                      color: view === key ? "var(--cc-text)" : "var(--cc-text-muted)",
                      boxShadow: view === key ? "0 1px 2px color-mix(in srgb, var(--cc-shadow-ink) 8%, transparent), 0 0 0 1px var(--cc-border)" : "none",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {view === "added" ? (
              <AddedBars bars={addedBars} axisLabel={axisLabel} report={false} launch={launch} />
            ) : view === "velocity" && !notes.has ? (
              <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: "24px 0 0" }}>{notes.empty}</p>
            ) : (
            <ResponsiveContainer width="100%" height="82%">
              <AreaChart data={audio.usageSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  {...TIME_AXIS}
                  tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={axisLabel}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  /* Sized to its own labels. A fixed width with the chart pulled
                     left to hide the gutter cut "280K" to "80K" at larger type. */
                  width="auto"
                  /* Velocity is a signed percentage and has to be allowed below
                     zero. Recharts defaults a numeric axis to [0, 'auto'], so
                     the view that exists to show a sound losing pace was the
                     one view that could not draw it -- a reading of -2.17% sat
                     clipped on the floor. Usage keeps the zero baseline, which
                     for a count is what you want. */
                  domain={view === "velocity" ? ["auto", "auto"] : [0, "auto"]}
                  allowDecimals={view === "velocity"}
                  tickFormatter={(v) => (view === "velocity" ? velocityTick(v) : formatCompact(Number(v)))}
                />
                <Tooltip
                  formatter={usageTooltipValue(view === "velocity" ? "velocity" : "usage")}
                  labelFormatter={(v) => readingInstant(v as number)}
                  labelStyle={{ fontSize: "var(--cc-t-12)"}}
                  contentStyle={{ fontSize: "var(--cc-t-12)", borderRadius: 8 }}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey={view === "velocity" ? "velocity" : "uses"}
                  stroke="var(--cc-primary)"
                  fill="var(--cc-primary)"
                  fillOpacity={0.14}
                  strokeWidth={2}
                  dot={view === "velocity" ? loneVelocityDot(audio.usageSeries, "var(--cc-primary)") : false}
                />
                {launchMarker(launch, false)}
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
          {view === "velocity" && notes.has && notes.approx ? (
            <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "8px 0 0" }}>{notes.approxNote}</p>
          ) : null}
          </>
        ) : (
          <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
            Usage over time appears once this sound has been synced more than once.
          </p>
        )}
    </EmbedFrame>
  );
}

/** A card of its own, or bare content inside the campaign's tabbed chart card. */
function EmbedFrame({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  if (embedded) return <div>{children}</div>;
  return (
    <Card>
      <div style={{ padding: 20 }}>{children}</div>
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
      <div style={{ fontSize: "var(--cc-t-12)", color: "var(--audio-tile-ink-muted, var(--cc-text-muted))", marginBottom: 4 }}>{label}</div>
      <div title={String(value)} style={{ fontSize: fitFigureSize(String(value), 20), fontWeight: 700, color: "var(--audio-tile-ink, var(--cc-text))", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}

/**
 * How many whole UTC days ago the newest reading was taken, or null when there
 * is none.
 *
 * UTC days on both sides rather than a millisecond age, and for the same reason
 * makeAxisLabel works in UTC: this renders on a server in UTC and hydrates in
 * the reader's zone, and a boolean derived from `Date.now() - at` can land on
 * opposite sides of a threshold in the two, which is a hydration mismatch. Day
 * granularity makes the two agree unless they straddle midnight UTC -- the same
 * exposure the axis label already carries, rather than a new one.
 */
function daysSinceLastReading(series: CampaignAudio["usageSeries"]): number | null {
  const last = series.at(-1)?.at;
  if (!last) return null;
  const then = Date.parse(`${last.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const today = new Date();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

/** Beyond this the tracker has stopped rather than merely lagged: the nightly
 *  cron runs at 04:00 UTC and the sweep more often than that, so two clear days
 *  without a reading is not a cadence, it is a failure. */
const STALE_AFTER_DAYS = 2;

/**
 * The client report's audio card.
 *
 * Every number below is measured off
 * https://lkay.creatorcore.co/client/jamie-macdonald-roots-7258461 at 1440,
 * where the card is 635 wide with 20px padding: tiles 88 tall on a 10px gap at
 * radius 20, the sound tile mid grey against two black stat tiles, and a 250px
 * chart whose area is a flat mid grey under a black line. Colours live in
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
  tabs,
  addedBars,
  fullSeries,
  outOfRange,
  atLaunch,
  launch,
}: {
  audio: CampaignAudio;
  cover: string | null;
  onCoverError: () => void;
  uses: string;
  added: string;
  view: AudioView;
  setView: (v: AudioView) => void;
  axisLabel: (v: number | string) => string;
  tabs: { key: AudioView; label: string }[];
  addedBars: { t: number; delta: number | null }[];
  /** Every reading, whatever the range: staleness is about the newest one. */
  fullSeries: CampaignAudio["usageSeries"];
  outOfRange: boolean;
  atLaunch: string | null;
  launch?: CampaignLaunch | null;
}) {
  const hasCurve = fullSeries.length > 1;
  const notes = velocityNotes(audio);
  /* A month-old figure rendered as a bare number claims to be current, and this
     document goes to a brand. The reference shows nothing here because its
     tracker is running; ours says so when it is not. Only when stale -- a
     healthy report is unchanged, and identical to the reference. */
  const staleDays = daysSinceLastReading(fullSeries);
  const isStale = staleDays !== null && staleDays > STALE_AFTER_DAYS;

  return (
    <section className="spr-card spr-audio">
      <h2 className="spr-section">{audio.platform === "INSTAGRAM" ? "Instagram Audio" : "TikTok Audio"}</h2>

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

      {isStale ? (
        <p className="spr-audio-stale">
          Last read {staleDays} days ago — these figures have not moved since.
        </p>
      ) : null}

      {atLaunch ? <p className="spr-audio-stale" data-testid="sound-at-launch">{atLaunch}</p> : null}

      {hasCurve ? (
        <>
          {/* Toggle above the title, plain text, the active one underlined --
              the reference's order, which is why this is a branch and not a
              set of custom properties. */}
          <div className="spr-audio-plot">
            <div className="spr-audio-toggle" role="group" aria-label="Audio chart view">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                className={`spr-audio-tab${view === key ? " is-on" : ""}`}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <h3 className="spr-audio-chart-title">
            {audioTitle(audio, view)}
          </h3>

          <div className="spr-audio-chart">
            {outOfRange ? (
              <p className="spr-note" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 16px" }}>
                {windowNote({ ...audio, usageSeries: fullSeries })}
              </p>
            ) : view === "added" ? (
              <AddedBars bars={addedBars} axisLabel={axisLabel} report launch={launch} />
            ) : view === "velocity" && !notes.has ? (
              <p className="spr-note" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 16px" }}>
                {notes.empty}
              </p>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={audio.usageSeries} margin={{ top: 4, right: 30, left: 0, bottom: 0 }}>
                <XAxis
                  {...TIME_AXIS}
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
                  /* Sized to its own labels: 46px with the chart pulled 8px
                     left cut "280K" to "80K" at this 14px type. */
                  width="auto"
                  /* Velocity is a signed percentage and has to be allowed below
                     zero; a count keeps its zero baseline. Same reasoning as the
                     dashboard card above. */
                  domain={view === "velocity" ? ["auto", "auto"] : [0, "auto"]}
                  allowDecimals={view === "velocity"}
                  tickFormatter={(v) => (view === "velocity" ? velocityTick(v) : formatCompact(Number(v)))}
                />
                <Tooltip
                  formatter={usageTooltipValue(view === "velocity" ? "velocity" : "usage")}
                  labelFormatter={(v) => readingInstant(v as number)}
                  labelStyle={{ fontSize: "var(--cc-t-12)"}}
                  contentStyle={{ fontSize: "var(--cc-t-12)", borderRadius: 8 }}
                />
                {/* Flat fill, no gradient and no opacity: the reference's area is
                    a solid mid grey meeting a black line, and a translucent fill
                    over a white card reads several shades lighter than that. */}
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey={view === "velocity" ? "velocity" : "uses"}
                  stroke="var(--spr-audio-line)"
                  fill="var(--spr-audio-area)"
                  fillOpacity={1}
                  strokeWidth={3}
                  dot={view === "velocity" ? loneVelocityDot(audio.usageSeries, "var(--spr-audio-line)") : false}
                />
                {launchMarker(launch, true)}
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
          {view === "velocity" && notes.has && notes.approx ? <p className="spr-audio-stale">{notes.approxNote}</p> : null}
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
