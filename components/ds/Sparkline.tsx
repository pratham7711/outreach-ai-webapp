import React from "react";

/**
 * A trend at a glance: one line, no axes, drawn in the text colour of where
 * it sits (a parent's `data-tone` recolours it). Decorative: the figure beside
 * it carries the number, so it is hidden from assistive tech.
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
  return (
    <svg className="cc-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
