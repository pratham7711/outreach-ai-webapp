"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { MetricHint } from "./MetricHint";
import { METRIC_DEFINITIONS, type MetricKey } from "@/lib/metric-definitions";
import { breakableFigure } from "./BreakableFigure";
import { useCompactCount } from "@/components/ds/ExactFigures";

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
  /** "plain" drops the tile's own surface, for a figure inside another card. */
  variant?: "card" | "plain";
  /** Size the figure as if it were this many characters long. A row passes its
   *  longest value here so every tile in it shares one size. */
  fitTo?: number;
  /** A mark for what is counted, drawn before the label. */
  icon?: LucideIcon;
};

const TREND_ICON = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
} as const;

/** Values this long step down from 28px to 22px. */
const COMPACT_AT = 13;

/**
 * One KPI: a label, a figure, and optionally a change and a footnote.
 *
 * Five tile implementations used to sit side by side, with figures at 16, 22,
 * 24, 28 and 36px and labels that broke mid-word ("ENGAGEMEN/T RATE",
 * "FOLLOW/ERS") once a five-across row squeezed each tile to 130px. The grid
 * (.cc-tiles-balanced) now keeps every tile at least 13rem wide, which is what
 * "10,825,413" needs at 28px, so the figure has two sizes instead of five:
 * 28px, or 22px for a value of 13 characters or more. The label wraps only
 * between words.
 */
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
  icon: Icon,
}: MetricTileProps) {
  const definition = metric ? METRIC_DEFINITIONS[metric] : undefined;
  const displayLabel = label ?? definition?.label ?? "";

  const valueText = typeof value === "string" || typeof value === "number" ? String(value) : null;
  /* A large count reads as 15.3M; the exact figure stays in the tooltip. */
  const compactCount = useCompactCount();
  const short = typeof value === "string" ? compactCount(value) : null;
  const compact = !short && Math.max(valueText?.length ?? 0, fitTo ?? 0) >= COMPACT_AT;

  const deltaIsGood = delta ? (delta.isGood ?? delta.trend === "up") : false;
  const DeltaIcon = delta ? TREND_ICON[delta.trend] : null;
  const deltaTone = delta?.trend === "flat" ? "flat" : deltaIsGood ? "good" : "bad";

  return (
    <div className="cc-metric-tile" data-metric-tile="" data-variant={variant === "plain" ? "plain" : undefined}>
      {/* The hint is a 44px touch target on phones and must not shrink, so the
          label is what gives way -- by wrapping at a space, never mid-word. */}
      <div className="cc-metric-tile-head">
        {Icon ? <Icon aria-hidden="true" className="cc-metric-tile-icon" /> : null}
        <span className="cc-metric-label">{displayLabel}</span>
        <MetricHint metric={metric} label={displayLabel} what={what} how={how} />
      </div>

      {/* A grouped figure may wrap, but only between its digit groups
          (breakableFigure), so every digit stays on screen. title keeps the
          plain figure for a value passed as a node. */}
      <span title={valueText ?? undefined} className="cc-metric-value" data-compact={compact || undefined}>
        {short ? short.short : valueText !== null && typeof value === "string" ? breakableFigure(value) : value}
      </span>

      {delta && DeltaIcon ? (
        <span className="cc-metric-deltarow">
          <span className="cc-metric-delta" data-tone={deltaTone}>
            <DeltaIcon aria-hidden="true" size={13} strokeWidth={2.5} />
            <span>{delta.value}</span>
          </span>
          {delta.label ? <span className="cc-metric-delta-label">{delta.label}</span> : null}
        </span>
      ) : null}

      {footer ? <div className="cc-metric-footer">{footer}</div> : null}
    </div>
  );
}
