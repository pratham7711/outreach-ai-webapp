"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SortableTh, type SortState } from "./SortableTh";
import { Skeleton } from "./Skeleton";
import { NoResults } from "./NoResults";
import { useCompactCount } from "@/components/ds/ExactFigures";

export type DataTableColumn<T> = {
  key: string;
  /** Column title. Rendered as the microlabel; an empty header needs `hideHeader`. */
  header: string;
  /** Keep the header for screen readers only (a row-actions column). */
  hideHeader?: boolean;
  /** Fixed width (px or any CSS length). Columns without one share what is left. */
  width?: number | string;
  /** Floor for a column with no fixed width, used to decide when the table scrolls. Default 160. */
  minWidth?: number;
  /** "right" for numbers: right-aligned, tabular, never wrapped. */
  align?: "left" | "right";
  /** Makes the header a sort button; pair with DataTable's `sort` and `onSort`. */
  sortKey?: string;
  /** The cell. Format numbers with formatFull and enums with enumLabel/platformLabel here. */
  render: (row: T, index: number) => React.ReactNode;
  /** One line with an ellipsis; the string given (or returned) becomes the cell's tooltip. */
  truncate?: string | ((row: T) => string | undefined);
  /** The column whose content links to `rowHref`. Defaults to the first column. */
  primary?: boolean;
  /** On a phone list row, the one figure shown beside the name. Every other column waits for the detail page. */
  phone?: boolean;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Makes the whole row open this URL; the primary cell becomes a real link for keyboards. */
  rowHref?: (row: T) => string | undefined;
  sort?: SortState | null;
  onSort?: (key: string) => void;
  /** With no rows yet: skeleton rows in these columns. With rows: they stay, dimmed. */
  loading?: boolean;
  skeletonRows?: number;
  /** Drawn under the headers when there are no rows. Defaults to <NoResults />. */
  empty?: React.ReactNode;
  /** Under the table, inside the card: the Pagination goes here. */
  footer?: React.ReactNode;
  /** Names the table for assistive tech. */
  caption?: string;
  /** Below this width the table scrolls sideways. Defaults to the sum of the column widths. */
  minWidth?: number;
  /** Pin the first column while a phone scrolls the rest. Default on. */
  stickyFirstColumn?: boolean;
  /** No card of its own, for a table that already sits in one (a SectionCard with padded={false}). */
  bare?: boolean;
  /**
   * On a phone, one line per row: the name, the `phone` column, a chevron, and
   * the lead cell's own link or button stretched over the row. On whenever rows
   * open a page (`rowHref`); set it for a row that opens a panel instead.
   */
  phoneList?: boolean;
  /** Keep the row's actions menu on a phone list row, in the chevron's place: for actions the opened page does not have. */
  phoneActions?: boolean;
  /**
   * For rows edited in place, with no page to open: a phone list row that a
   * tap opens into the full card and closes again. Implies `phoneList`.
   */
  phoneExpand?: boolean;
  className?: string;
};

const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='button'], [role='menuitem'], [role='checkbox'], [role='switch'], [role='combobox'], [data-row-stop]";

const SKELETON_WIDTHS = ["72%", "56%", "64%", "48%"];

const cssLength = (v: number | string) => (typeof v === "number" ? `${v}px` : v);

/**
 * The one listing table.
 *
 * Listings were built three ways (native tables, CSS-grid divs, flex rows), so
 * header weight, cell padding, row height, number alignment and the ground
 * under the rows all differed by page, and the grid ones lost tabular figures
 * because the global rule only targets `table`. This is a native table with a
 * <colgroup>, so columns keep their widths when there are no rows; the empty
 * state is a row under the headers instead of a replacement for the table; and
 * numbers are right-aligned by declaring `align: "right"` on the column.
 *
 * A row is only clickable when `rowHref` is given -- the cursor and the hover
 * say so, and the primary cell is a real link so the keyboard and a middle
 * click get the same destination. Clicks on anything interactive inside the row
 * (a ⋯ menu, a checkbox) are left alone.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  sort = null,
  onSort,
  loading = false,
  skeletonRows = 8,
  empty,
  footer,
  caption,
  minWidth,
  stickyFirstColumn = true,
  bare = false,
  phoneList,
  phoneActions,
  phoneExpand,
  className,
}: DataTableProps<T>) {
  const compactCount = useCompactCount();
  const router = useRouter();
  const skeleton = loading && rows.length === 0;
  const primaryKey = rowHref ? (columns.find((c) => c.primary) ?? columns[0])?.key : undefined;
  /* The cell that heads a row when a phone stacks it into a card. */
  const leadKey = (columns.find((c) => c.primary) ?? columns.find((c) => !c.hideHeader))?.key;
  const tableMin =
    minWidth ?? columns.reduce((sum, c) => sum + (typeof c.width === "number" ? c.width : (c.minWidth ?? 160)), 0);

  const follow = (e: React.MouseEvent<HTMLTableRowElement>, href: string) => {
    if (e.defaultPrevented || (e.target as Element).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
      window.open(href, "_blank", "noopener");
      return;
    }
    router.push(href);
  };

  const [openRows, setOpenRows] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggleRow = (e: React.MouseEvent<HTMLTableRowElement>, key: string) => {
    if (e.defaultPrevented || (e.target as Element).closest(INTERACTIVE)) return;
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  let body: React.ReactNode;
  if (skeleton) {
    body = Array.from({ length: skeletonRows }, (_, i) => (
      <tr key={`s${i}`} className="cc-dt-skeleton-row">
        {columns.map((c, j) => (
          <td key={c.key} data-align={c.align}>
            {c.hideHeader ? null : (
              <Skeleton width={c.align === "right" ? 56 : SKELETON_WIDTHS[(i + j) % SKELETON_WIDTHS.length]} height={12} />
            )}
          </td>
        ))}
      </tr>
    ));
  } else if (rows.length === 0) {
    body = (
      <tr className="cc-dt-empty">
        <td colSpan={columns.length}>{empty ?? <NoResults />}</td>
      </tr>
    );
  } else {
    body = rows.map((row, i) => {
      const href = rowHref?.(row);
      const key = rowKey(row);
      return (
        <tr
          key={key}
          data-href={href || undefined}
          data-open={(phoneExpand && openRows.has(key)) || undefined}
          onClick={href ? (e) => follow(e, href) : phoneExpand ? (e) => toggleRow(e, key) : undefined}
          onAuxClick={href ? (e) => e.button === 1 && follow(e, href) : undefined}
        >
          {columns.map((c) => {
            let content = c.render(row, i);
            const short = typeof content === "string" ? compactCount(content) : null;
            if (short) content = <span title={short.exact}>{short.short}</span>;
            const tip = typeof c.truncate === "function" ? c.truncate(row) : c.truncate;
            if (c.truncate !== undefined) content = <span className="cc-dt-truncate">{content}</span>;
            if (href && c.key === primaryKey) {
              content = (
                <Link href={href} className="cc-dt-primary">
                  {content}
                </Link>
              );
            }
            return (
              <td
                key={c.key}
                data-align={c.align}
                data-label={c.hideHeader || c.key === leadKey ? undefined : c.header}
                data-lead={c.key === leadKey || undefined}
                data-phone={c.phone || undefined}
                title={tip || undefined}
              >
                {content}
              </td>
            );
          })}
        </tr>
      );
    });
  }

  return (
    <div className={`${bare ? "cc-dt-wrap" : "cc-dt-card"}${className ? ` ${className}` : ""}`}>
      <div className="cc-dt-scroll">
        <table
          className="cc-dt"
          style={{ "--cc-dt-min": `${tableMin}px` } as React.CSSProperties}
          aria-busy={loading || undefined}
          data-sticky-first={stickyFirstColumn || undefined}
          data-phone-list={(phoneList ?? (Boolean(rowHref) || phoneExpand)) || undefined}
          data-phone-actions={phoneActions || undefined}
        >
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={c.width === undefined ? undefined : { width: cssLength(c.width) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => (
                <SortableTh
                  key={c.key}
                  label={c.header}
                  hideLabel={c.hideHeader}
                  align={c.align}
                  sortKey={c.sortKey}
                  sort={sort}
                  onToggle={onSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      {footer ? <div className="cc-dt-foot">{footer}</div> : null}
    </div>
  );
}
