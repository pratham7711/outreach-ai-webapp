import React from "react";

export type PageHeaderProps = {
  title: React.ReactNode;
  /** One line under the title. Say what the page counts, not what it is. */
  subtitle?: React.ReactNode;
  /** Buttons, filters — anything right-aligned on the same baseline as the title. */
  actions?: React.ReactNode;
  /** Rendered between the title block and the actions, e.g. a freshness chip. */
  meta?: React.ReactNode;
  /**
   * The record count for a list page — "200 Creators", "19 Lists".
   *
   * Rendered as a SIBLING below the header row, not inside it, because that is
   * where CreatorCore puts it: MEASURED 2026-09-14, their stack on a list page
   * is header strip -> caption -> filter bar, and ours had nothing in the middle
   * slot. Putting it in `subtitle` instead would place it inside the strip and
   * leave the gap it is meant to fill.
   */
  caption?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * The one page header. Before this existed the h1 was re-declared inline on every page
 * and had drifted to three sizes (26/28) and two weights (700/800), which reads as three
 * different products when a client clicks through the nav.
 *
 * Layout and type both live in globals.css now — `.rsp-header` for the row,
 * `.cc-page-title` for the h1 — and both read `--cc-*` tokens, so a theme can
 * restyle and re-place this header without touching a line of it.
 *
 * This replaces the exported PAGE_TITLE_STYLE constant. That constant was spread
 * inline into five detail pages, and an inline style out-specifies every theme
 * rule — which is why `.creatorcore` needed three `!important` declarations to
 * reach its own 24px/700. Those are deleted along with the constant.
 */
export function PageHeader({ title, subtitle, actions, meta, caption, className, style }: PageHeaderProps) {
  return (
    <>
    <div className={`rsp-header ${className ?? ""}`} style={style} data-region="page-header" data-parity="page.header-strip">
      <div className="cc-page-heading">
        <h1 className="cc-page-title" data-parity="page.title">{title}</h1>
        {subtitle ? <p className="cc-page-subtitle">{subtitle}</p> : null}
        {meta}
      </div>
      {actions ? (
        <div className="cc-page-actions" data-region="page-actions">
          {actions}
        </div>
      ) : null}
    </div>
    {caption ? (
      <p className="cc-page-caption" data-region="page-caption">{caption}</p>
    ) : null}
    </>
  );
}
