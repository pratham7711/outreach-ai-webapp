"use client";
import React from "react";
import { Card } from "@pratham7711/ui";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { Disc3 } from "lucide-react";
import { formatCompact, formatFull, fitFigureSize } from "@/lib/format";
import type { CampaignStreams } from "@/lib/songs/streams";

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

function DailyBars({ daily, report }: { daily: CampaignStreams["daily"]; report: boolean }) {
  const tick = { fontSize: report ? 14 : 11, fill: report ? "var(--spr-audio-axis)" : "var(--cc-text-muted)" };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={withMissedDays(daily)} margin={{ top: 4, right: report ? 30 : 8, left: report ? 0 : -12, bottom: 0 }}>
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

export function SpotifyStreamsCard({ streams, variant = "dashboard" }: { streams: CampaignStreams; variant?: Variant }) {
  const total = streams.totalPlays === null ? "—" : formatFull(streams.totalPlays);
  const lastDay = signed(streams.lastDay);
  const since = sinceLine(streams);
  const hasBars = streams.daily.length > 0;
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
        {hasBars ? (
          <div className="spr-audio-plot">
            <h3 className="spr-audio-chart-title">Daily Streams</h3>
            <div className="spr-audio-chart">
              <DailyBars daily={streams.daily} report />
            </div>
          </div>
        ) : (
          <p className="spr-note">Daily streams appear once Spotify has been read two days in a row.</p>
        )}
      </section>
    );
  }

  return (
    <Card>
      <div style={{ padding: 20 }} data-testid="spotify-streams">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Disc3 size={16} style={{ color: "var(--audio-title-ink, var(--cc-text-muted))" }} aria-hidden="true" />
          <span style={{ fontSize: "var(--audio-title-size, 15px)", fontWeight: 700, color: "var(--audio-title-ink, var(--cc-text))" }}>
            Spotify Streams
          </span>
        </div>

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
            <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: "0 0 16px" }}>
              {since ? `${since} ` : ""}Spotify&apos;s public play count, read once a day
              {streams.latestDay ? `; last read ${shortDay(streams.latestDay)}` : ""}.
            </p>
            {hasBars ? (
              <div style={{ height: 210 }}>
                <span style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 8 }}>
                  Daily Streams
                </span>
                <div style={{ height: "82%" }}>
                  <DailyBars daily={streams.daily} report={false} />
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
      <div title={value} style={{ fontSize: fitFigureSize(value, 20), fontWeight: 700, color: "var(--audio-tile-ink, var(--cc-text))", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}
