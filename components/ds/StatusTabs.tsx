"use client";

import React from "react";
import { Badge } from "@pratham7711/ui";

type BadgeVariant = "accent" | "success" | "warning" | "danger" | "neutral";

export type StatusTab = {
  key: string;
  label: string;
  color?: string;
  bg?: string;
  count?: number;
  badgeVariant?: BadgeVariant;
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
        const color = resolveStatusColor(tab.color);
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
              }}
            >
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
            {isSelected && (
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
            )}
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
