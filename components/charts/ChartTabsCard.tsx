"use client";

import React, { useId, useRef, useState } from "react";
import { Card } from "@pratham7711/ui";
import { RangeToggle } from "@/components/charts/RangeToggle";
import type { ChartRange, SeriesMode } from "@/lib/charts/seriesMode";

export type ChartTab = {
  key: string;
  label: string;
  /** The tab's headline figure ("2.3M"), so the reader sees it without opening the tab. */
  figure?: string | null;
  /** false when the tab would open on an empty state; the card opens on the first tab that has data. */
  hasData?: boolean;
  render: (range: ChartRange, series: { mode: SeriesMode; setMode: (m: SeriesMode) => void }) => React.ReactNode;
};

/**
 * One card, one chart at a time, one range for all of them.
 *
 * The campaign's charts were four cards stacked down the page, each with its
 * own switch in its own style. Tabs keep the page to one chart's height, the
 * range picked on one tab holds on the next, and each tab carries its
 * headline figure. The range AND the Daily/Cumulative choice are the card's,
 * so both hold from tab to tab instead of resetting with each chart. Only
 * tabs that have data are passed in; one that would open on an empty state
 * says so with hasData: false and is not the one the card opens on.
 */
export function ChartTabsCard({ tabs, title = "Campaign charts" }: { tabs: ChartTab[]; title?: string }) {
  const [active, setActive] = useState(() => (tabs.find((t) => t.hasData !== false) ?? tabs[0])?.key ?? "");
  const [range, setRange] = useState<ChartRange>("all");
  const [mode, setMode] = useState<SeriesMode>("cumulative");
  const id = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!current) return null;

  /* The tablist pattern's keys: arrows move between tabs, Home and End jump. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === current.key);
    const next =
      e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(tabs[next].key);
    tabRefs.current[tabs[next].key]?.focus();
  };

  return (
    /* noPadding, not an inline padding of 0: the inline style lost to the
       card body's own inset, so the tab bar's rule stopped 24px short of both
       edges. The tabs are the app's underline tabs -- 14px, a 2px ink rule
       under the chosen one, 24px apart -- with the headline figure after the
       label where a tab strip elsewhere puts its count. */
    <Card variant="outlined" noPadding>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", columnGap: 16, rowGap: 8, flexWrap: "wrap",
          padding: "0 var(--cc-card-inset)", borderBottom: "1px solid var(--cc-border)",
        }}
      >
        <div role="tablist" aria-label={title} onKeyDown={onKeyDown} style={{ display: "flex", columnGap: 24, flexWrap: "nowrap", overflowX: "auto", scrollbarWidth: "none", minWidth: 0, maxWidth: "100%" }}>
          {tabs.map((t) => {
            const on = t.key === current.key;
            return (
              <button
                key={t.key}
                ref={(el) => { tabRefs.current[t.key] = el; }}
                id={`${id}-tab-${t.key}`}
                type="button"
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                aria-controls={`${id}-panel`}
                onClick={() => setActive(t.key)}
                className="rsp-touch"
                style={{
                  font: "inherit", border: "none", cursor: "pointer", padding: "12px 0", background: "transparent",
                  display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap",
                  color: on ? "var(--cc-text)" : "var(--cc-text-muted)",
                  boxShadow: on ? "inset 0 -2px 0 var(--cc-text)" : "none",
                }}
              >
                <span style={{ fontSize: "var(--cc-t-14)", fontWeight: on ? 600 : 500 }}>{t.label}</span>
                {t.figure ? (
                  <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", fontVariantNumeric: "tabular-nums" }}>{t.figure}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <RangeToggle value={range} onChange={setRange} label={`${title} range`} />
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${current.key}`} style={{ padding: "var(--cc-card-inset)" }}>
        {current.render(range, { mode, setMode })}
      </div>
    </Card>
  );
}
