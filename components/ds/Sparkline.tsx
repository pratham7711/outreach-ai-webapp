import React from "react";

/**
 * A trend at a glance: one line, no axes, drawn in the text colour of where
 * it sits (a parent's `data-tone` recolours it). Decorative: the figure beside
 * it carries the number, so it is hidden from assistive tech. `data-dir` says
 * which way the line itself went, so a hovered row can colour it up or down.
 */
export function Sparkline({ values, width = 72, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const first = values[0];
  const last = values[values.length - 1];
  const dir = last > first ? "up" : last < first ? "down" : "flat";
  return (
    <svg className="cc-sparkline" data-dir={dir} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <polygon className="cc-sparkline-area" points={`0,${height} ${pts} ${width},${height}`} />
      <polyline className="cc-sparkline-line" points={pts} pathLength={1} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
