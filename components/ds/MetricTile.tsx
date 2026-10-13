"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MetricHint } from "./MetricHint";
import { METRIC_DEFINITIONS, type MetricKey } from "@/lib/metric-definitions";
import { breakableFigure } from "./BreakableFigure";

type Trend = "up" | "down" | "flat";

type MetricTileProps = {
  metric?: MetricKey;
  label?: string;
  value: React.ReactNode;
  what?: string;
  how?: string;
  delta?: {
    value: string;
    trend: Trend;
    label?: string;
    isGood?: boolean;
  };
  footer?: React.ReactNode;
  variant?: "card" | "plain";
  /** Step the figure's size as if it were this many characters long. A row
   *  passes its longest value here so every tile in it shares one size. */
  fitTo?: number;
};

const TREND_ICON = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
} as const;

export function MetricTile({
  metric,
  label,
  value,
  what,
  how,
  delta,
  footer,
  variant = "card",
  fitTo,
}: MetricTileProps) {
  const definition = metric ? METRIC_DEFINITIONS[metric] : undefined;
  const displayLabel = label ?? definition?.label ?? "";

  /**
   * Size the figure to fit the tile.
   *
   * These tiles are a six-column grid above 1280px, which leaves each one about
   * 143px of text room. Full numbers are far wider than the compact ones this
   * was built for: a bold tabular digit costs ~0.6em and a comma ~0.3em, so
   * "300,500,000" is ~6.0em -- 168px at 28px, which overflows the card. Nothing
   * wraps it either, because CSS finds no break opportunity inside a
   * comma-grouped number.
   *
   * Stepping the size down by length keeps the whole figure visible, which is
   * the entire point of showing the full number instead of "1.4M". Only strings
   * can be measured; a ReactNode value keeps the base size.
   *
   * Measured per tile, a row mixed sizes: "81,581,033" stepped down to 22px
   * beside "8.58%" at 28px. `fitTo` lets the row decide once.
   */
  const valueText = typeof value === "string" || typeof value === "number" ? String(value) : null;
  const len = Math.max(valueText?.length ?? 0, fitTo ?? 0);
  const valueSize =
    variant === "plain"
      ? len >= 15 ? "text-[13px]" : len >= 12 ? "text-[15px]" : len >= 9 ? "text-[18px]" : "text-[22px]"
      : len >= 15 ? "text-[15px]" : len >= 12 ? "text-[18px]" : len >= 9 ? "text-[22px]" : "text-[28px]";

  const deltaIsGood = delta ? (delta.isGood ?? delta.trend === "up") : false;
  const DeltaIcon = delta ? TREND_ICON[delta.trend] : null;
  const deltaTone =
    delta?.trend === "flat"
      ? "text-muted-foreground"
      : deltaIsGood
        ? "text-status-good"
        : "text-status-critical";

  const body = (
    <>
      {/* min-w-0 on the row and on the label: the hint beside it is a 44px
          touch target that must not shrink, so when the tile is narrow the
          label is what gives way. Without this the button painted 7.5px
          outside the tile at a 390px window. MEASURED 2026-09-15.

          It gives way by WRAPPING, not by an ellipsis. Truncated, a phone
          read "AVG ENGA…", "ACTIVE CAM…" and "NEW USES / 2…" (MEASURED
          2026-10-13 at 390) -- a label cut mid-word is a guess, not a label. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="cc-metric-label min-w-0 break-words">
          {displayLabel}
        </span>
        <MetricHint metric={metric} label={displayLabel} what={what} how={how} />
      </div>

      <span
        /* Wraps between digit groups when the step-down above is not enough,
           rather than cutting the figure: "2,400,…" on a phone tile read as a
           different number. title stays, for a figure passed as a node. */
        title={valueText ?? undefined}
        className={`leading-none font-bold tracking-[-0.02em] break-words text-foreground tabular-nums ${valueSize}`}
      >
        {valueText !== null && typeof value === "string" ? breakableFigure(value) : value}
      </span>

      {delta && DeltaIcon ? (
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${deltaTone}`}>
          <DeltaIcon aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
          <span>{delta.value}</span>
          {delta.label ? (
            <span className="font-normal text-muted-foreground">{delta.label}</span>
          ) : null}
        </span>
      ) : null}

      {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </>
  );

  if (variant === "plain") {
    return <div className="flex min-w-0 flex-col gap-2">{body}</div>;
  }

  return (
    <Card className="gap-0" data-metric-tile="">
      <CardContent className="flex min-w-0 flex-col gap-2">{body}</CardContent>
    </Card>
  );
}
