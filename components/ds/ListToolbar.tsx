"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";

export type ListToolbarSearch = {
  value: string;
  onChange: (value: string) => void;
  /** "Search <plural noun>", sentence case, no ellipsis: "Search campaigns". */
  placeholder: string;
  /** Defaults to the placeholder. */
  ariaLabel?: string;
};

/**
 * The row between a listing's header and its table: search on the left, the
 * list's own controls on the right, every control one height.
 *
 * Nine listings put their search in nine places, at widths from 200 to 1112px,
 * and sized it by matching its placeholder text in CSS -- so rewording a
 * placeholder silently dropped the sizing. The toolbar owns that box now.
 *
 * `end` takes the right-hand controls in their reading order: quick filters,
 * then sort, then the Filters button, then a view toggle or a ⋯ menu.
 * On a phone the search takes the whole first line and the controls wrap below.
 *
 * The field is drawn with the library's input classes so it is the same box as
 * every other field (one edge, one height), without importing the library's
 * component into every test that renders a toolbar.
 */
export function ListToolbar({
  search,
  end,
  className,
}: {
  search?: ListToolbarSearch;
  end?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`cc-toolbar${className ? ` ${className}` : ""}`}>
      {search ? (
        <div className="cc-toolbar-search" role="search">
          <div className="ui-input-wrap">
            <span className="ui-input-icon-left" aria-hidden="true">
              <Search size={16} />
            </span>
            <input
              type="text"
              className="ui-input ui-input-md ui-input-with-left"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.ariaLabel ?? search.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      ) : null}
      {end ? <div className="cc-toolbar-end">{end}</div> : null}
    </div>
  );
}
