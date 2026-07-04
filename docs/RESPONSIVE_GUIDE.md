# Responsive System — mandatory for every surface

> Adopted 2026-07-04 (Pratham: "responsive for all screens, best practices, intelligent use of space"). Utilities live in `app/globals.css` under "Responsive system". Tokens stay inline (`var(--cc-*)`); responsive behavior comes from these classes or Tailwind responsive prefixes — never from JS width sniffing.

## Breakpoints

| Name | Width | Target |
|---|---|---|
| base | < 640px | phones (design at 375px) |
| sm | ≥ 640px | large phones |
| md | ≥ 768px | tablets |
| lg | ≥ 1024px | laptops (sidebar visible) |
| xl | ≥ 1280–1440px | desktops (content max-width 1440 centered) |

## Utility classes

| Class | Behavior |
|---|---|
| `.rsp-page` | page wrapper: 16→24→32px padding, max-width 1440 centered |
| `.rsp-grid-tiles` | KPI tiles: 2 → 3 → 6 columns |
| `.rsp-grid-2` / `.rsp-grid-3` | card grids collapsing to 1 column on phones |
| `.rsp-split` | side-by-side panels that stack below lg (two-pane inbox, chart+leaderboard) |
| `.rsp-table-wrap` | horizontal-scroll container for data tables (min-width 720 inside) |
| `.rsp-header` | page-header row that wraps actions under the title on phones |
| `.rsp-hide-mobile` / `.rsp-only-mobile` | visibility helpers |
| `.rsp-touch` | 44px minimum touch targets below md |

## Hard rules (the checklist every page must pass)

1. **No horizontal page scroll at 375px.** Ever. Tables scroll inside `.rsp-table-wrap`, not the page.
2. Every data table is wrapped in `.rsp-table-wrap`; on phones prefer showing the 3–4 highest-value columns (`.rsp-hide-mobile` on the rest) over cramming.
3. KPI/stat rows use `.rsp-grid-tiles` (or grid classes) — never fixed-width flex rows.
4. Two-pane layouts (inbox, chart+table) use `.rsp-split`; the list pane becomes full-width above the detail pane on phones.
5. Page headers use `.rsp-header`; action buttons wrap below the title, never overflow.
6. Modals: max-width 560 desktop; below md they take `calc(100vw - 32px)` width and scroll internally (max-height 85vh).
7. Charts always live in recharts `ResponsiveContainer` with a fixed height per breakpoint (220 phone / 300 desktop is the house default).
8. Ultra-wide: content never stretches past 1440px (`.rsp-page`); whitespace goes to the margins, not inside cards.
9. Touch targets ≥ 44px below md (`.rsp-touch` or explicit padding).
10. Filters/toolbars wrap (`flexWrap: "wrap"`) with 8px gaps; selects/inputs get `minWidth: 0` so they shrink.
11. Typography scale stays fixed (h1 28/700, subtitle 14) — space adapts, not type.
12. Existing rules still apply: `var(--cc-*)` tokens only, 8px grid, loading/empty/error states, no code comments.

## Definition of done per page

Playwright screenshot at 375 / 768 / 1440 widths shows: no page-level horizontal overflow, no clipped/overlapping controls, primary action reachable without scrolling sideways.
