import React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export type PageHeaderBack = {
  href: string;
  /** The parent's name, as the rail and the breadcrumb call it: "Campaigns", "Creator Roster". */
  label: string;
};

export type PageHeaderProps = {
  title: React.ReactNode;
  /** One line under the title. Say what the page counts, not what it is. */
  subtitle?: React.ReactNode;
  /**
   * Buttons only: the page's main action, at most two labelled secondaries,
   * then a MoreMenu for the rest. A count or a status is not an action; it
   * goes in `subtitle` or `meta`, where it does not push the buttons around.
   */
  actions?: React.ReactNode;
  /**
   * The facts line under the title on a detail page: a date, counts, a handle.
   * Each direct child is one fact, and the stylesheet draws the dot between
   * them, so a caller never types a separator.
   */
  meta?: React.ReactNode;
  /** Status badges on the title's own line, after the h1. */
  badges?: React.ReactNode;
  /**
   * A detail page's way back: a square chevron to the left of the title.
   * Always a link to the parent, never history.back() -- a deep-linked
   * visitor's history is somebody else's site.
   */
  back?: PageHeaderBack;
  /** An avatar or artwork beside the title block, about 40px. */
  leading?: React.ReactNode;
  /**
   * The page's tab strip (StatusTabs). Drawn inside the header band, directly
   * under the title, so a listing reads header, tabs, toolbar, table; the
   * strip's own rule stands in for the band's hairline.
   */
  tabs?: React.ReactNode;
  /**
   * @deprecated A count between the header and the toolbar. Put the count in
   * the active tab's pill or the table's footer instead; kept for the two
   * parked pages that still pass it.
   */
  caption?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * The one page header, for list pages and detail pages alike.
 *
 * It is a band: title row, then optional tabs, with a hairline under it that
 * runs the width of the content column. Layout and type live in globals.css
 * (`.cc-page-band`, `.rsp-header`, `.cc-page-title`) and read `--cc-*` tokens.
 *
 * Before this carried back/badges/meta/tabs, detail pages hand-rolled their
 * own headers and the title landed at five different x positions; the
 * campaign page closed with an X at the far right and the post page went back
 * through the browser history.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  meta,
  badges,
  back,
  leading,
  tabs,
  caption,
  className,
  style,
}: PageHeaderProps) {
  return (
    <>
      <header
        className={`rsp-header cc-page-band ${className ?? ""}`}
        style={style}
        data-region="page-header"
        data-parity="page.header-strip"
        data-has-tabs={tabs ? "" : undefined}
        data-has-back={back ? "" : undefined}
      >
        <div className="cc-page-lead">
          {back ? (
            <Link
              href={back.href}
              className="cc-page-back"
              aria-label={`Back to ${back.label}`}
              title={`Back to ${back.label}`}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </Link>
          ) : null}
          {leading ? <div className="cc-page-leading">{leading}</div> : null}
          <div className="cc-page-heading">
            <div className="cc-page-titleline">
              <h1 className="cc-page-title" data-parity="page.title">{title}</h1>
              {badges ? <div className="cc-page-titlemeta">{badges}</div> : null}
            </div>
            {subtitle ? <p className="cc-page-subtitle">{subtitle}</p> : null}
            {meta ? (
              <div className="cc-page-meta" data-region="page-meta">
                {meta}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="cc-page-actions" data-region="page-actions">
            {actions}
          </div>
        ) : null}
        {tabs ? <div className="cc-page-tabs">{tabs}</div> : null}
      </header>
      {caption ? (
        <p className="cc-page-caption" data-region="page-caption">{caption}</p>
      ) : null}
    </>
  );
}
