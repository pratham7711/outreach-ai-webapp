import { createElement, type CSSProperties, type ReactNode } from "react";
import { platformLabel } from "@/lib/format";
import { platformDef } from "@/lib/platforms/registry";

/*
 * The chart chrome every Recharts chart shares. Seven files each kept their own
 * copy of a tooltip style (popover ground, radius 10, padding 10px 14px, 13px)
 * and an axis tick (11 or 12px, 500 or 400), and two legends printed the raw
 * platform enum ("INSTAGRAM").
 *
 *   <Tooltip {...chartTooltipProps} formatter={...} />
 *   <XAxis tick={chartAxisTick} />
 *   <Legend {...chartLegendProps} />
 */

/** The tooltip box: dark (inverted) in both themes -- the page's ink as the
 *  ground and its paper as the text, so it reads apart from the white card. */
export const chartTooltipStyle: CSSProperties = {
  background: "var(--foreground)",
  border: "none",
  borderRadius: "var(--cc-r-control)",
  color: "var(--background)",
  boxShadow: "var(--ui-shadow-md)",
  fontSize: "var(--cc-t-12)",
  lineHeight: 1.4,
  padding: "8px 12px",
};

/** Series rows take the tooltip's text colour; a series colour on the dark
 *  ground (a grey ramp in the monochrome themes) would not read. */
export const chartTooltipItemStyle: CSSProperties = { color: "inherit", padding: 0 };

export const chartTooltipLabelStyle: CSSProperties = { color: "inherit", fontWeight: 600, marginBottom: 4 };

export const chartTooltipProps = {
  contentStyle: chartTooltipStyle,
  itemStyle: chartTooltipItemStyle,
  labelStyle: chartTooltipLabelStyle,
  wrapperStyle: { outline: "none" } as CSSProperties,
};

/** Axis tick text: 12px muted. */
export const chartAxisTick = { fill: "var(--cc-text-muted)", fontSize: 12 } as const;

/** A legend entry in muted text; a platform key is shown by its name. */
export function chartLegendFormatter(value: unknown): ReactNode {
  const text = String(value ?? "");
  return createElement(
    "span",
    { style: { color: "var(--cc-text-muted)" } },
    platformDef(text) ? platformLabel(text) : text,
  );
}

/** itemSorter null keeps the series order the chart declares (Recharts 3
 *  sorts legend entries A-Z by default). */
export const chartLegendProps = {
  itemSorter: null,
  iconSize: 8,
  iconType: "circle" as const,
  wrapperStyle: { fontSize: "var(--cc-t-12)" } as CSSProperties,
  formatter: chartLegendFormatter,
};
