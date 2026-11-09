"use client";

import React from "react";
import { Badge } from "@pratham7711/ui";
import { statusColorToken, statusInk } from "@/lib/statusColors";

type BadgeVariant = "accent" | "success" | "warning" | "danger" | "neutral";

export type StatusTab = {
  key: string;
  label: string;
  color?: string;
  bg?: string;
  count?: number;
  /** @deprecated Ignored. Counts are neutral in every tab, selected or not. */
  badgeVariant?: BadgeVariant;
  /** Shown before the label: in the tab's status colour, or the label's when the tab has none. */
  icon?: React.ReactNode;
};

export type StatusTabsProps = {
  tabs: StatusTab[];
  active: string;
  onChange: (key: string) => void;
  /** `underline` for a page's or a card's tabs; `pill` only for a small in-card toggle. */
  variant?: "underline" | "pill";
  ariaLabel?: string;
  /**
   * Ties the strip to the panel it switches. Each tab gets the id
   * `<idBase>-tab-<key>` and `aria-controls="<idBase>-panel"`; the page renders
   * `<div role="tabpanel" id="<idBase>-panel" aria-labelledby="<idBase>-tab-<active>">`.
   * Leave it off for a strip that filters a list rather than swapping a panel.
   */
  idBase?: string;
  style?: React.CSSProperties;
};

/**
 * The colour of a tab's status: its icon in the underline strip, its tint in the pill.
 *
 * A caller may hand us a whole status style, and a status style's `color` is
 * the text colour for that status's own chip -- for a solid-fill status like
 * Active that is pure white, which painted onto this strip is white on a
 * near-white page: label, underline and icon all gone. statusInk picks
 * whichever of the pair can be seen on the surface, so the fill colour carries
 * a solid status and a tinted one keeps its foreground.
 */
function tabInk(tab: StatusTab): string {
  const base =
    tab.bg && tab.color
      ? statusColorToken(statusInk({ bg: tab.bg, color: tab.color }))
      : statusColorToken(tab.color);

  /* A CSS variable is already theme-correct; only a literal from the status
     palette needs help.

     Those literals are copied from the reference app for chip parity, where
     each sits on a 12.5% tint of itself. On this strip there is no tint -- the
     label sits on the page -- and Complete's green measured 2.29:1 there.
     Darkening the palette would fix light and break dark, so the mix is toward
     --cc-text instead: that token is near-black in light and near-white in
     dark, so the same expression pushes the hue
     away from whichever ground it is actually on. The status stays recognisably
     its own colour; it just stops being the lightest thing on the page.

     How far it is pushed is --cc-status-ink-strength, because CreatorCore does
     not push it at all: their Pending and Canceled measure exactly the raw
     palette values in lib/statusColors.ts. */
  if (base.startsWith("var(") || base.startsWith("color-mix(")) return base;
  return `color-mix(in srgb, ${base} var(--cc-status-ink-strength), var(--cc-text))`;
}

export function StatusTabs({ tabs, active, onChange, variant = "underline", ariaLabel = "Filter by status", idBase, style }: StatusTabsProps) {
  /* Arrow keys walk the strip and Enter or Space picks, the manual-activation
     tab pattern: one tab stop for the whole strip (the selected tab), so Tab
     moves on to the toolbar instead of through every status. Activation stays
     a click, because on a listing a pick is a navigation. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const list = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? list.length - 1
      : (at + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  };
  const hasSelected = tabs.some((t) => t.key === active);

  return (
    <div role="tablist" aria-label={ariaLabel} className="cc-tabs" data-variant={variant} style={style} onKeyDown={onKeyDown}>
      {tabs.map((tab, i) => {
        const isSelected = active === tab.key;
        const showCount = typeof tab.count === "number" && tab.count > 0;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-tab-${tab.key}` : undefined}
            aria-controls={idBase ? `${idBase}-panel` : undefined}
            aria-selected={isSelected}
            tabIndex={isSelected || (!hasSelected && i === 0) ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className="cc-tab"
            /* The one value that stays inline: a status colour is computed per
               tab, so it cannot live in a stylesheet -- but as a custom
               property it is a value the cascade can still reach. In the
               underline variant it colours the tab's icon only; the label and
               the indicator are ink. A tab with no status (Overview,
               Activity) draws its icon in the label's own colour. */
            style={{ "--cc-tab-ink": tab.color || tab.bg || variant === "pill" ? tabInk(tab) : "currentColor" } as React.CSSProperties}
          >
            {tab.icon}
            {tab.label}
            {showCount &&
              (variant === "pill" ? (
                <span className="cc-tab-count">{tab.count}</span>
              ) : (
                /* Neutral whether or not the tab is selected: the underline
                   already says which one is, and a tinted count beside it was
                   a second, competing marker. */
                <Badge className="cc-tab-count" variant="neutral" size="sm">
                  {tab.count}
                </Badge>
              ))}
          </button>
        );
      })}
    </div>
  );
}
