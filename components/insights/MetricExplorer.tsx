"use client";

import { useId, useState, type ReactNode } from "react";
import { formatCount } from "@/components/portal/app/ui";
import { NUM } from "@/components/insights/parts";
import { Sparkline, TotalAreaChart, type DayValue } from "@/components/insights/charts";

export type ExplorerMetric = {
  key: string;
  label: string;
  /** The tile's headline: a period total, or the latest reading of a running total. */
  value: number | null;
  /** Written in place of the number (a signed net change). */
  display?: string;
  note?: ReactNode;
  points: DayValue[];
  /** A running total (followers) keeps its axis off zero; a daily count starts at zero. */
  kind: "total" | "daily";
  describe: (value: number) => string;
};

/**
 * A row of metric tiles, each with its own sparkline, over one large chart of
 * the tile that is chosen. One chart at a time instead of four small ones:
 * the tiles say how every metric moved, the chart says exactly how one did.
 * A metric with no figures for the period is left out, never drawn empty.
 */
export function MetricExplorer({ metrics: all, label, echo }: { metrics: ExplorerMetric[]; label: string; echo?: boolean }) {
  const metrics = all.filter((m) => m.value !== null || m.display !== undefined);
  const charted = metrics.filter((m) => m.points.length > 1);
  const [chosen, setChosen] = useState<string | null>(null);
  const active = charted.find((m) => m.key === chosen) ?? charted[0] ?? null;
  const chartId = useId();
  if (metrics.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div role="group" aria-label={label} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 118px), 1fr))" }}>
        {metrics.map((m) => {
          const canChart = m.points.length > 1;
          const on = active?.key === m.key;
          return (
            <button
              key={m.key}
              type="button"
              disabled={!canChart}
              aria-pressed={canChart ? on : undefined}
              aria-controls={canChart ? chartId : undefined}
              onClick={() => setChosen(m.key)}
              className="rsp-touch"
              style={{
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 14px",
                minWidth: 0,
                borderRadius: 12,
                cursor: canChart ? "pointer" : "default",
                background: on ? "var(--cc-plat-tint, var(--cc-primary-light))" : "var(--cc-card)",
                border: on ? "1.5px solid var(--cc-plat-accent, var(--cc-primary))" : "1px solid var(--cc-border)",
                color: "var(--cc-text)",
                font: "inherit",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)", lineHeight: 1.3 }}>{m.label}</span>
              <span style={{ ...NUM, fontSize: "clamp(16px, 1.45vw, 20px)", fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap" }}>{m.display ?? formatCount(m.value)}</span>
              {m.note && <span style={{ fontSize: 12, color: "var(--cc-text-muted)", lineHeight: 1.3 }}>{m.note}</span>}
              {canChart && (
                <span style={{ marginTop: 2 }}>
                  <Sparkline values={m.points.map((p) => p.value)} color={on ? "var(--cc-plat-accent, var(--cc-primary))" : "var(--cc-text-muted)"} width={110} height={26} fluid />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <div id={chartId}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 8px" }}>
            {active.label}
            <span style={{ fontWeight: 400, color: "var(--cc-text-muted)" }}>{active.kind === "daily" ? " · by day" : " · each day"}</span>
          </p>
          <TotalAreaChart
            key={active.key}
            points={active.points}
            label={`${active.label} by day`}
            unit={active.label.toLowerCase()}
            describe={active.describe}
            fromZero={active.kind === "daily"}
            color="var(--cc-plat-accent, var(--cc-primary))"
            echo={echo ? "var(--cc-plat-echo)" : undefined}
            height={240}
          />
        </div>
      )}
    </div>
  );
}
