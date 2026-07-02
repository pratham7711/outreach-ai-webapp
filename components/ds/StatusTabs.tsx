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
  ariaLabel?: string;
  style?: React.CSSProperties;
};

export function StatusTabs({ tabs, active, onChange, ariaLabel = "Filter by status", style }: StatusTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        gap: 6,
        borderBottom: "1px solid var(--cc-border)",
        overflowX: "auto",
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isSelected = active === tab.key;
        const color = tab.color ?? "var(--cc-primary)";
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
            {typeof tab.count === "number" && tab.count > 0 && (
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
