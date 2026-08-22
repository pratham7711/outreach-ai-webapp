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
export function AudioCard({ audio, shareToken }: { audio: CampaignAudio; shareToken?: string }) {
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
          <Stat label="Videos Added (24h)" value={added} />
        </div>

        {/* One point is not a curve; the chart appears once there are two. */}
        {audio.usageSeries.length > 1 ? (
          <div style={{ height: 180 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>
              Audio Usage
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={audio.usageSeries} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompact(Number(v))} />
                <Tooltip formatter={(v) => formatCompact(Number(v))} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Area type="monotone" dataKey="uses" stroke="var(--cc-primary)" fill="var(--cc-primary)" fillOpacity={0.14} strokeWidth={2} />
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
