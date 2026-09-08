"use client";
import { Modal, Badge } from "@pratham7711/ui";
import { Music, RefreshCw } from "lucide-react";
import { formatCompact, formatDateAbs, timeAgo } from "@/lib/format";
import type { ChartGranularity } from "@/lib/trackers/granularity";
import { AudioUsesChart, VelocityChart, type SeriesPoint } from "./SoundCharts";
import { changeOver } from "./horizonChange";

/**
 * The audio detail, mirroring the reference: a cumulative level chart beside a
 * change chart, with the change read at several horizons above them.
 *
 * It is a modal rather than a route because the reference addresses it as
 * ?tracker=<id> on the list page — which keeps the URL shareable (the thing a
 * separate route is usually chosen for) without pulling the list out from under
 * the reader when they close it.
 */

export type DetailSound = {
  id: string;
  title: string;
  artist: string;
  coverImageUrl: string | null;
  tiktokSoundId: string;
  trackedSince: string;
  health: "pending" | "live" | "regressed" | "stale";
  lastReadAt: string | null;
  latestSnapshot: { usesCount: number } | null;
  series: SeriesPoint[];
  chartGranularity: ChartGranularity;
};

const HORIZONS: { label: string; days: number }[] = [
  { label: "24H Change", days: 1 },
  { label: "7-Day Change", days: 7 },
  { label: "14-Day Change", days: 14 },
  { label: "30-Day Change", days: 30 },
];

export function SoundDetailModal({
  sound,
  open,
  onClose,
  onRefresh,
  refreshing = false,
}: {
  sound: DetailSound | null;
  open: boolean;
  onClose: () => void;
  /* The reference offers refresh only per tracker, from this modal. The parent
     owns the mutation so the list and the modal invalidate together -- refreshing
     here and seeing the row behind still stale would read as a failed refresh. */
  onRefresh?: (soundId: string) => void;
  refreshing?: boolean;
}) {
  if (!sound) return null;
  const stale = sound.health !== "live";

  return (
    <Modal open={open} onClose={onClose} title="" size="lg">
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <div
          style={{
            width: 52, height: 52, borderRadius: 12, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--cc-primary-light)", overflow: "hidden",
          }}
        >
          {sound.coverImageUrl ? (
            <img src={sound.coverImageUrl} alt="" style={{ width: 52, height: 52, objectFit: "cover" }} />
          ) : (
            <Music size={22} style={{ color: "var(--cc-primary)" }} />
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{sound.title}</div>
          <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            {sound.artist || "Unknown artist"}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {onRefresh ? (
            <button
              onClick={() => onRefresh(sound.id)}
              disabled={refreshing}
              title="Read this sound from TikTok now"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: "1px solid var(--cc-border)", background: "var(--cc-card)",
                color: "var(--cc-text)", cursor: refreshing ? "default" : "pointer",
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              <RefreshCw
                size={14}
                style={{ animation: refreshing ? "cc-spin 1s linear infinite" : undefined }}
              />
              {refreshing ? "Refreshing…" : "Refresh Data"}
            </button>
          ) : null}
          {stale ? (
            <Badge variant="warning" size="sm">
              {sound.health === "pending" ? "awaiting first reading" : "not updating"}
            </Badge>
          ) : (
            <Badge variant="success" size="sm">live</Badge>
          )}
        </div>
      </div>

      {stale && sound.lastReadAt ? (
        <div
          role="status"
          style={{
            borderLeft: "3px solid var(--cc-warning)",
            background: "var(--cc-card)",
            padding: "10px 14px",
            marginBottom: 18,
            fontSize: 13,
            color: "var(--cc-text)",
          }}
        >
          Readings stopped {timeAgo(sound.lastReadAt)} ({formatDateAbs(sound.lastReadAt)}). The
          figures below are the last known values, not current ones.
        </div>
      ) : null}

      <div className="rsp-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section
          style={{
            background: "var(--cc-card)", border: "1px solid var(--cc-border)",
            borderRadius: 12, padding: 16, minWidth: 0,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
            Audio Uses
          </h3>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 10 }}>
            {sound.latestSnapshot ? formatCompact(sound.latestSnapshot.usesCount) : "—"}
          </div>
          <AudioUsesChart series={sound.series} granularity={sound.chartGranularity} />
        </section>

        <section
          style={{
            background: "var(--cc-card)", border: "1px solid var(--cc-border)",
            borderRadius: 12, padding: 16, minWidth: 0,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)", marginBottom: 10 }}>
            Velocity
          </h3>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
            {HORIZONS.map((h) => {
              const c = changeOver(sound.series, h.days);
              return (
                <div key={h.label} style={{ minWidth: 84 }}>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{h.label}</div>
                  {c === "short-history" ? (
                    <div
                      style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text-muted)" }}
                      title={`Not enough history — this sound has no reading from ${h.days} days ago yet.`}
                    >
                      —
                    </div>
                  ) : c ? (
                    <div style={{ fontSize: 14, fontWeight: 700, color: c.added < 0 ? "var(--cc-danger)" : "var(--cc-text)" }}>
                      {c.added >= 0 ? "+" : ""}
                      {formatCompact(c.added)}
                      {c.percent !== null ? (
                        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--cc-text-muted)", marginLeft: 4 }}>
                          {c.percent >= 0 ? "+" : ""}
                          {c.percent.toFixed(2)}%
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    /* The reference's own wording for this case, and the right
                       one: not a zero, an absence. */
                    <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>No data yet.</div>
                  )}
                </div>
              );
            })}
          </div>
          <VelocityChart series={sound.series} granularity={sound.chartGranularity} />
        </section>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: "var(--cc-text-muted)" }}>
        Tracked since {formatDateAbs(sound.trackedSince)} · {sound.series.length} points ·{" "}
        {sound.chartGranularity} granularity
        {sound.lastReadAt ? <> · last read {timeAgo(sound.lastReadAt)}</> : null}
      </div>
    </Modal>
  );
}
