"use client";
import React from "react";
import { Card } from "@pratham7711/ui";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea } from "recharts";
import { Disc3 } from "lucide-react";
import { formatCompact, formatFull, fitFigureSize } from "@/lib/format";
import type { CampaignStreams } from "@/lib/songs/streams";
import { SeriesModeToggle } from "@/components/charts/SeriesModeToggle";
import { fillUtcDays, rangeStartDay, type ChartRange, type SeriesMode } from "@/lib/charts/seriesMode";
import { launchLabel, launchShortDay, type CampaignLaunch } from "@/lib/campaigns/launch";
import { LIFT_MIN_DAYS, streamLift } from "@/lib/songs/streamLift";

/**
 * The promoted song on Spotify: its all-time play count, the streams on the
 * newest day, and a bar per day read.
 *
 * Shared by the campaign's Performance tab and the public share report, like
 * AudioCard beside it, and styled with that card's classes on the report so
 * the two read as one family. The report only ever receives a card with a
 * reading (redactForShare); the "not read yet" note is the dashboard's, and so
 * is the line saying whether the track was linked or matched.
 */

/** How the dashboard names where the track came from. */
export const TRACK_SOURCE_LABEL = {
  linked: "Linked on the campaign",
  matched: "Matched by title and artist",
} as const;

type Variant = "dashboard" | "report";

/** "14 Oct", from a YYYY-MM-DD that is already a UTC day. */
function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function signed(n: number | null): string {
  return n === null ? "—" : `+${formatFull(n)}`;
}

function sinceLine(streams: CampaignStreams): string | null {
  const s = streams.sinceFirst;
  if (!s) return null;
  return `${signed(s.streams)} streams since tracking began on ${shortDay(s.fromDay)} (${s.days} ${s.days === 1 ? "day" : "days"}).`;
}

const DAY_MS = 86_400_000;

/**
 * What the launch did to streams, in words: the total since it and the daily
 * average either side (lib/songs/streamLift). `team` adds the hint only the
 * campaign's own tab needs -- how to get a baseline next time -- and a share
 * link drops the lines that are about our tracking rather than the song.
 */
export function liftLines(
  streams: CampaignStreams,
  launch: CampaignLaunch | null | undefined,
  team: boolean,
): { headline: string | null; detail: string | null } | null {
  if (!launch) return null;
  const lift = streamLift(streams, launch.day);
  if (!lift) return null;
  const at = `the ${launchLabel(launch).toLowerCase()} (${launchShortDay(launch)})`;
  const headline = lift.sinceStreams !== null ? `+${formatFull(lift.sinceStreams)} streams since ${at}` : null;
  if (lift.kind === "lift") {
    const multiple = lift.multiple === null ? "" : ` (${lift.multiple.toFixed(1)}×)`;
    return {
      headline,
      detail: `Daily average ${formatFull(Math.round(lift.beforeAvg))} before → ${formatFull(Math.round(lift.sinceAvg))} since${multiple}, over ${lift.beforeDays} and ${lift.sinceDays} days with a count.`,
    };
  }
  if (lift.kind === "noBaseline") {
    return team
      ? {
          headline: null,
          detail: `Streams were first read on ${shortDay(lift.firstReadDay)}, after ${at}, so there is no before-launch figure. Attach the song before posts go live to get one.`,
        }
      : null;
  }
  const noun = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  return {
    headline,
    detail: team
      ? `${noun(lift.beforeDays)} with a count before ${at} and ${noun(lift.sinceDays)} since; a before-and-since average needs ${LIFT_MIN_DAYS} on each side.`
      : null,
  };
}

/** The launch day on a chart keyed by day, and the stretch after it shaded. */
function launchMarks(days: readonly { day: string }[], launch: CampaignLaunch | null | undefined, report: boolean) {
  if (!launch || days.length === 0 || !days.some((d) => d.day === launch.day)) return null;
  const ink = report ? "var(--spr-audio-axis)" : "var(--cc-text-muted)";
  const last = days[days.length - 1].day;
  return [
    last > launch.day ? (
      <ReferenceArea key="since" x1={launch.day} x2={last} fill={report ? "var(--spr-audio-area)" : "var(--cc-primary)"} fillOpacity={report ? 0.25 : 0.06} ifOverflow="hidden" />
    ) : null,
    <ReferenceLine
      key="launch"
      x={launch.day}
      stroke={ink}
      strokeDasharray="4 3"
      label={{ value: launchLabel(launch), position: "insideTopLeft", fontSize: 11, fill: ink }}
    />,
  ];
}

/**
 * Every day from the first bar to the last, with a missed day as an empty slot.
 * Without the slots the axis would run 6 Oct straight into 9 Oct and the two
 * days nobody read would vanish instead of showing as a hole.
 */
function withMissedDays(daily: CampaignStreams["daily"]): { day: string; streams: number | null }[] {
  if (daily.length < 2) return daily;
  const byDay = new Map(daily.map((d) => [d.day, d.streams]));
  const last = Date.parse(`${daily[daily.length - 1].day}T00:00:00Z`);
  const out: { day: string; streams: number | null }[] = [];
  for (let t = Date.parse(`${daily[0].day}T00:00:00Z`); t <= last; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, streams: byDay.get(day) ?? null });
  }
  return out;
}

function DailyBars({ daily, report, launch }: { daily: CampaignStreams["daily"]; report: boolean; launch?: CampaignLaunch | null }) {
  const tick = { fontSize: report ? 14 : 11, fill: report ? "var(--spr-audio-axis)" : "var(--cc-text-muted)" };
  const days = withMissedDays(daily);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={days} margin={{ top: 4, right: report ? 30 : 8, left: report ? 0 : -12, bottom: 0 }}>
        {launchMarks(days, launch, report)}
        <XAxis dataKey="day" tick={tick} tickLine={false} axisLine={false} tickFormatter={shortDay} minTickGap={24} />
        <YAxis
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={report ? 56 : undefined}
          allowDecimals={false}
          tickFormatter={(v) => formatCompact(Number(v))}
        />
        <Tooltip
          formatter={(v: unknown) => [v === null || v === undefined ? "Not read" : formatFull(Number(v)), "Streams"]}
          labelFormatter={(v) => `${shortDay(String(v))} (UTC)`}
          labelStyle={{ fontSize: "var(--cc-t-12)" }}
          contentStyle={{ fontSize: "var(--cc-t-12)", borderRadius: 8 }}
        />
        <Bar
          isAnimationActive={false}
          dataKey="streams"
          fill={report ? "var(--spr-audio-area)" : "var(--cc-primary)"}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Spotify's all-time count on each day it was read, a missed day as a break in
 * the line. It is the track's whole history on Spotify, not only the
 * campaign's share of it.
 */
function TotalLine({ plays, report, launch }: { plays: CampaignStreams["plays"]; report: boolean; launch?: CampaignLaunch | null }) {
  const tick = { fontSize: report ? 14 : 11, fill: report ? "var(--spr-audio-axis)" : "var(--cc-text-muted)" };
  const days = fillUtcDays<{ day: string; count: number | null }>(plays, (p) => p.day, (day) => ({ day, count: null }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={days} margin={{ top: 4, right: report ? 30 : 8, left: report ? 0 : -12, bottom: 0 }}>
        {launchMarks(days, launch, report)}
        <XAxis dataKey="day" tick={tick} tickLine={false} axisLine={false} tickFormatter={shortDay} minTickGap={24} />
        <YAxis
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={report ? 56 : undefined}
          domain={["auto", "auto"]}
          tickFormatter={(v) => formatCompact(Number(v))}
        />
        <Tooltip
          formatter={(v: unknown) => [v === null || v === undefined ? "Not read" : formatFull(Number(v)), "Total plays"]}
          labelFormatter={(v) => `${shortDay(String(v))} (UTC)`}
          labelStyle={{ fontSize: "var(--cc-t-12)" }}
          contentStyle={{ fontSize: "var(--cc-t-12)", borderRadius: 8 }}
        />
        <Line
          isAnimationActive={false}
          type="monotone"
          dataKey="count"
          stroke={report ? "var(--spr-audio-line)" : "var(--cc-primary)"}
          strokeWidth={2}
          strokeDasharray="0"
          dot={days.length <= 3}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SpotifyStreamsCard({
  streams,
  variant = "dashboard",
  range = "all",
  launch,
  embedded = false,
  mode: givenMode,
  onModeChange,
}: {
  streams: CampaignStreams;
  variant?: Variant;
  /** How far back the chart looks; the tiles and the lines above it always cover everything. */
  range?: ChartRange;
  launch?: CampaignLaunch | null;
  /** Inside the campaign's tabbed chart card, whose tab already says Spotify. */
  embedded?: boolean;
  /** The tabbed card's Daily/Cumulative, so it holds across its tabs. */
  mode?: SeriesMode;
  onModeChange?: (m: SeriesMode) => void;
}) {
  const [ownMode, setOwnMode] = React.useState<SeriesMode>("daily");
  const mode = givenMode ?? ownMode;
  const setMode = onModeChange ?? setOwnMode;
  const total = streams.totalPlays === null ? "—" : formatFull(streams.totalPlays);
  const lastDay = signed(streams.lastDay);
  const since = sinceLine(streams);
  /* A payload cached before `plays` existed has none; the card then stays on
     daily bars, as it was. */
  const allPlays = streams.plays ?? [];
  const lift = liftLines({ ...streams, plays: allPlays }, launch, variant === "dashboard");
  /* Each day's streams were worked out over every reading; the range only
     cuts what is drawn, so the window's first bar keeps its figure. */
  const start = rangeStartDay(range);
  const daily = start === null ? streams.daily : streams.daily.filter((d) => d.day >= start);
  const plays = start === null ? allPlays : allPlays.filter((p) => p.day >= start);
  const hasBars = streams.daily.length > 0;
  const outOfRange = start !== null && hasBars && daily.length === 0 && plays.length < 2;
  const canSwitch = hasBars && allPlays.length >= 2;
  const showTotal = canSwitch && mode === "cumulative";
  const track = streams.track;

  if (variant === "report") {
    return (
      <section className="spr-card spr-audio spr-streams" data-testid="spotify-streams">
        <h2 className="spr-section">Spotify Streams</h2>
        <div className="spr-audio-tiles">
          {track ? (
            <a className="spr-audio-sound" href={track.url} target="_blank" rel="noopener noreferrer">
              <span className="spr-audio-cover spr-audio-cover-fallback" aria-hidden="true">
                <Disc3 size={22} />
              </span>
              <span className="spr-audio-names">
                <span className="spr-audio-track">{track.name || streams.songTitle}</span>
                <span className="spr-audio-artist">{track.artists}</span>
              </span>
            </a>
          ) : null}
          <div className="spr-audio-stat">
            <span className="spr-audio-stat-label">Total Plays</span>
            <span className="spr-audio-stat-value" title={total} style={{ fontSize: fitFigureSize(total, 20) }}>{total}</span>
          </div>
          <div className="spr-audio-stat">
            <span className="spr-audio-stat-label">Last Day</span>
            <span className="spr-audio-stat-value" title={lastDay} style={{ fontSize: fitFigureSize(lastDay, 20) }}>{lastDay}</span>
          </div>
        </div>
        {since ? <p className="spr-audio-stale">{since}</p> : null}
        {lift?.headline ? <p className="spr-audio-stale" data-testid="stream-lift"><strong>{lift.headline}</strong>{lift.detail ? `. ${lift.detail}` : ""}</p> : null}
        {outOfRange ? (
          <p className="spr-note">No Spotify readings in this range{streams.latestDay ? `; last read ${shortDay(streams.latestDay)}` : ""}.</p>
        ) : hasBars ? (
          <div className="spr-audio-plot">
            {canSwitch ? (
              <div className="spr-audio-toggle" role="group" aria-label="Spotify chart view">
                {(["daily", "cumulative"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={mode === key}
                    className={`spr-audio-tab${mode === key ? " is-on" : ""}`}
                    onClick={() => setMode(key)}
                  >
                    {key === "daily" ? "Daily" : "Cumulative"}
                  </button>
                ))}
              </div>
            ) : null}
            <h3 className="spr-audio-chart-title">{showTotal ? "Total Plays" : "Daily Streams"}</h3>
            <div className="spr-audio-chart">
              {showTotal ? <TotalLine plays={plays} report launch={launch} /> : <DailyBars daily={daily} report launch={launch} />}
            </div>
          </div>
        ) : (
          <p className="spr-note">Daily streams appear once Spotify has been read two days in a row.</p>
        )}
      </section>
    );
  }

  const body = (
      <div style={{ padding: embedded ? 0 : 20 }} data-testid="spotify-streams">
        {embedded ? null : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Disc3 size={16} style={{ color: "var(--audio-title-ink, var(--cc-text-muted))" }} aria-hidden="true" />
          <span style={{ fontSize: "var(--audio-title-size, 15px)", fontWeight: 700, color: "var(--audio-title-ink, var(--cc-text))" }}>
            Spotify Streams
          </span>
        </div>
        )}

        {streams.note ? (
          <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
            <strong style={{ color: "var(--cc-text)" }}>{streams.songTitle}</strong>: {streams.note}
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
              {track ? (
                <a
                  href={track.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex", alignItems: "center", gap: 12, flex: "1 1 240px", minWidth: 0,
                    padding: 12, borderRadius: "var(--audio-tile-radius, 12px)",
                    border: "1px solid var(--audio-tile-border, var(--cc-border))",
                    background: "var(--audio-tile-bg, var(--cc-bg))", textDecoration: "none",
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "var(--audio-tile-fill, var(--cc-card))",
                      border: "1px solid var(--audio-tile-border, var(--cc-border))",
                    }}
                  >
                    <Disc3 size={18} style={{ color: "var(--audio-tile-ink-muted, var(--cc-text-subtle))" }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--audio-tile-ink, var(--cc-text))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {track.name || streams.songTitle}
                    </div>
                    <div style={{ fontSize: "var(--cc-t-13)", color: "var(--audio-tile-ink-muted, var(--cc-text-muted))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {track.artists}
                    </div>
                    {streams.trackSource ? (
                      <div
                        data-testid="spotify-track-source"
                        style={{ fontSize: "var(--cc-t-12)", color: "var(--audio-tile-ink-muted, var(--cc-text-muted))", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {TRACK_SOURCE_LABEL[streams.trackSource]}
                      </div>
                    ) : null}
                  </div>
                </a>
              ) : null}
              <Stat label="Total Plays" value={total} />
              <Stat label="Last Day" value={lastDay} />
            </div>
            {lift ? (
              <div
                data-testid="stream-lift"
                style={{
                  margin: "0 0 12px", padding: "10px 12px", borderRadius: "var(--audio-tile-radius, 12px)",
                  border: "1px solid var(--audio-tile-border, var(--cc-border))", background: "var(--audio-tile-bg, var(--cc-bg))",
                }}
              >
                {lift.headline ? (
                  <div style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: "var(--cc-text)", fontVariantNumeric: "tabular-nums" }}>{lift.headline}</div>
                ) : null}
                {lift.detail ? (
                  <div style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", marginTop: lift.headline ? 2 : 0 }}>{lift.detail}</div>
                ) : null}
              </div>
            ) : null}
            <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: "0 0 16px" }}>
              {since ? `${since} ` : ""}Spotify&apos;s public play count, read once a day
              {streams.latestDay ? `; last read ${shortDay(streams.latestDay)}` : ""}.
            </p>
            {outOfRange ? (
              <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
                No Spotify readings in this range{streams.latestDay ? `; last read ${shortDay(streams.latestDay)}` : ""}.
              </p>
            ) : hasBars ? (
              <div style={{ height: 210 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>
                    {showTotal ? "Total Plays" : "Daily Streams"}
                  </span>
                  {canSwitch ? <SeriesModeToggle label="Spotify streams" value={mode} onChange={setMode} /> : null}
                </div>
                <div style={{ height: "74%" }}>
                  {showTotal ? <TotalLine plays={plays} report={false} launch={launch} /> : <DailyBars daily={daily} report={false} launch={launch} />}
                </div>
              </div>
            ) : (
              <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
                Daily streams appear once Spotify has been read two days in a row.
              </p>
            )}
          </>
        )}
      </div>
  );
  return embedded ? body : <Card>{body}</Card>;
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
      <div title={value} style={{ fontSize: fitFigureSize(value, 20), fontWeight: 700, color: "var(--audio-tile-ink, var(--cc-text))", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}
