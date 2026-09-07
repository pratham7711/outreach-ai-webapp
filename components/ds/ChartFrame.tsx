"use client";

import React from "react";
import { ResponsiveContainer } from "recharts";

export type ChartFrameProps = {
  /** Fixed pixel height. Omit to fill the parent, which must then have a height. */
  height?: number;
  /**
   * Floor the box never drops below. Recharts measures its parent on first paint and
   * logs "The width(-1) and height(-1) of chart should be greater than 0" whenever that
   * measurement comes back at or below zero — which is what a percentage-height container
   * inside a flex/grid track, a lazily-mounted tab panel, or a not-yet-laid-out card does.
   * A floor means the measurement is never zero, so the chart draws on the first frame.
   */
  minHeight?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Exactly one Recharts chart element. */
  children: React.ReactElement;
};

export const CHART_FRAME_MIN_HEIGHT = 160;

export function ChartFrame({
  height,
  minHeight = CHART_FRAME_MIN_HEIGHT,
  className,
  style,
  children,
}: ChartFrameProps) {
  return (
    <div
      data-chart-frame=""
      className={className}
      style={{
        width: "100%",
        // A flex/grid child defaults to min-width:auto, which stops it shrinking and
        // leaves the chart wider than its track on narrow viewports.
        minWidth: 0,
        height: height ?? "100%",
        minHeight: Math.max(height ?? 0, minHeight),
        ...style,
      }}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
