"use client";

import type { ReactNode } from "react";
import { SearchX, X } from "lucide-react";

/**
 * "Nothing matches what you asked for", as distinct from "there is nothing yet".
 *
 * Six listings said six different things here, and two of them said the wrong
 * one: the audit log answered a search that matched nothing with its first-run
 * copy ("Changes made in this organization will appear here"), and the lists
 * page showed nothing at all. A filtered view that comes back empty is about
 * the filter, so the copy says so and the one action offered is to undo it.
 *
 * A page shows this when a search or filter is set, and its own first-run empty
 * state (with the create action) only when there is genuinely no data.
 * Inside a DataTable it renders under the column headers.
 */
export function NoResults({
  title = "No results found",
  description = "Try adjusting your search or filter to find what you're looking for.",
  onClear,
  clearLabel = "Clear filters",
  icon,
  className,
}: {
  title?: string;
  description?: ReactNode;
  /** Resets the search and filters. Omit when there is nothing to reset. */
  onClear?: () => void;
  clearLabel?: string;
  /** Replaces the search glyph, e.g. for a first-run state built on this. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`cc-no-results${className ? ` ${className}` : ""}`} role="status">
      <span className="cc-no-results-icon" aria-hidden="true">
        {icon ?? <SearchX size={32} strokeWidth={1.75} />}
      </span>
      <p className="cc-no-results-title">{title}</p>
      {description ? <p className="cc-no-results-body">{description}</p> : null}
      {onClear ? (
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm cc-no-results-action" onClick={onClear}>
          <X size={14} aria-hidden="true" />
          {clearLabel}
        </button>
      ) : null}
    </div>
  );
}
