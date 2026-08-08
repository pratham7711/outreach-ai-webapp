"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MetricHint } from "./MetricHint";
import { METRIC_DEFINITIONS, type MetricKey } from "@/lib/metric-definitions";

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
}: MetricTileProps) {
  const definition = metric ? METRIC_DEFINITIONS[metric] : undefined;
  const displayLabel = label ?? definition?.label ?? "";

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
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          {displayLabel}
        </span>
        <MetricHint metric={metric} label={displayLabel} what={what} how={how} />
      </div>

      <span
        className={`leading-none font-bold tracking-[-0.02em] text-foreground tabular-nums ${
          variant === "plain" ? "text-[22px]" : "text-[28px]"
        }`}
      >
        {value}
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
    return <div className="flex flex-col gap-2">{body}</div>;
  }

  return (
    <Card className="gap-0">
      <CardContent className="flex flex-col gap-2">{body}</CardContent>
    </Card>
  );
}
