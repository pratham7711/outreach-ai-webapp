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
  const isPill = variant === "pill";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        gap: isPill ? 8 : 6,
        borderBottom: isPill ? undefined : "1px solid var(--cc-border)",
        overflowX: "auto",
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isSelected = active === tab.key;
        const color = tabInk(tab);
        const showCount = typeof tab.count === "number" && tab.count > 0;
        if (isPill) {
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onChange(tab.key)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: isSelected ? `color-mix(in srgb, ${color} 16%, transparent)` : "transparent",
                color: isSelected ? color : "var(--cc-text-muted)",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {tab.icon}
              {tab.label}
              {showCount && (
                <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>{tab.count}</span>
              )}
            </button>
          );
        }
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onChange(tab.key)}
            className="cc-filter-tab"
            style={{
              padding: "10px 16px",
              borderRadius: 0,
              borderBottom: isSelected ? `2px solid ${color}` : "2px solid transparent",
              background: "transparent",
              color: isSelected ? color : undefined,
              fontWeight: isSelected ? 600 : 500,
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: -1,
              whiteSpace: "nowrap",
            }}
          >
            {tab.icon ??
              (isSelected && (
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
              ))}
            {tab.label}
            {showCount && (
              <Badge variant={isSelected ? (tab.badgeVariant ?? "accent") : "neutral"} size="sm">
                {tab.count}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
