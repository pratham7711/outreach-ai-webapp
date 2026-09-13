"use client";

import React from "react";
import { Badge } from "@pratham7711/ui";
import { statusInk } from "@/lib/statusColors";

type BadgeVariant = "accent" | "success" | "warning" | "danger" | "neutral";

export type StatusTab = {
  key: string;
  label: string;
  color?: string;
  bg?: string;
  count?: number;
  badgeVariant?: BadgeVariant;
  /** Shown before the label. In the underline variant it replaces the selected dot. */
  icon?: React.ReactNode;
};

export type StatusTabsProps = {
  tabs: StatusTab[];
  active: string;
  onChange: (key: string) => void;
  variant?: "underline" | "pill";
  ariaLabel?: string;
  style?: React.CSSProperties;
};

const STATUS_COLOR_TOKENS: Record<string, string> = {
  "#374151": "var(--cc-text)",
  "#d97706": "var(--cc-warning)",
  "#059669": "var(--cc-success)",
  "#dc2626": "var(--cc-danger)",
  "#4f46e5": "var(--cc-primary)",
  "#4338ca": "var(--cc-primary)",
};

function resolveStatusColor(color?: string): string {
  if (!color) return "var(--cc-primary)";
  return STATUS_COLOR_TOKENS[color.trim().toLowerCase()] ?? color;
}

/**
 * The colour to draw a tab's label, underline, dot and icon in.
 *
 * A caller may hand us a whole status style, and a status style's `color` is
 * the text colour for that status's own chip -- for a solid-fill status like
 * Active that is #FFFFFF, which painted onto this strip is white on a
 * near-white page: label, underline and icon all gone. statusInk picks
 * whichever of the pair can be seen on the surface, so the fill colour carries
 * a solid status and a tinted one keeps its foreground.
 */
function tabInk(tab: StatusTab): string {
  const base =
    tab.bg && tab.color
      ? resolveStatusColor(statusInk({ bg: tab.bg, color: tab.color }))
      : resolveStatusColor(tab.color);

  /* A CSS variable is already theme-correct; only a literal from the status
     palette needs help.

     Those literals are copied from the reference app for chip parity, where
     each sits on a 12.5% tint of itself. On this strip there is no tint -- the
     label sits on the page -- and Complete's #56BA57 measured 2.29:1 there.
     Darkening the palette would fix the light themes and break the dark one, so
     the mix is toward --cc-text instead: that token is near-black in light and
     creatorcore and near-white in dark, so the same expression pushes the hue
     away from whichever ground it is actually on. The status stays recognisably
     its own colour; it just stops being the lightest thing on the page. */
  if (base.startsWith("var(") || base.startsWith("color-mix(")) return base;
  return `color-mix(in srgb, ${base} 62%, var(--cc-text))`;
}

export function StatusTabs({ tabs, active, onChange, variant = "underline", ariaLabel = "Filter by status", style }: StatusTabsProps) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="cc-tabs" data-variant={variant} style={style}>
      {tabs.map((tab) => {
        const isSelected = active === tab.key;
        const showCount = typeof tab.count === "number" && tab.count > 0;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onChange(tab.key)}
            className="cc-tab"
            /* The one value that stays inline, and the reason the rest could
               leave: a status colour is computed per tab, so it cannot live in
               a stylesheet -- but as a custom property it is a value the
               cascade can still reach, not a declaration that outranks it.
               Padding, radius, weight and background used to ride along here
               and silently beat every theme rule aimed at this strip. */
            style={{ "--cc-tab-ink": tabInk(tab) } as React.CSSProperties}
          >
            {tab.icon ?? (isSelected && variant === "underline" && <span aria-hidden="true" className="cc-tab-dot" />)}
            {tab.label}
            {showCount &&
              (variant === "pill" ? (
                <span className="cc-tab-count">{tab.count}</span>
              ) : (
                <Badge variant={isSelected ? (tab.badgeVariant ?? "accent") : "neutral"} size="sm">
                  {tab.count}
                </Badge>
              ))}
          </button>
        );
      })}
    </div>
  );
}
