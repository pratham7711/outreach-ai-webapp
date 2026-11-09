import Link from "next/link";
import type { CSSProperties } from "react";
import { formatFull, platformLabel } from "@/lib/format";
import { distinctPlatformColors } from "@/app/(dashboard)/analytics/shared";

export type PlatformSplitRow = {
  platform: string;
  /** Null when none of the platform's posts has a view count read yet: drawn "—", not 0. */
  views: number | null;
  posts: number;
};

function shareText(share: number): string {
  const pct = Math.round(share * 100);
  return pct === 0 && share > 0 ? "<1%" : `${pct}%`;
}

/**
 * Views by platform, as one labelled bar per platform.
 *
 * The same fact was drawn five ways: a donut with a legend of values on the
 * dashboard, all-black bars under a coloured legend on /analytics, a donut with
 * no numbers on campaign Performance, a donut printing raw enums on campaign
 * Analytics, and labelled bars on the song page. This is the song page's
 * DistributionRow, which read best: a dot in the platform's colour and its
 * name, a bar filled to its share of the views, the figure, and "64% · 41
 * posts". Rows run biggest first. Colours come from distinctPlatformColors, so
 * a platform is the same hue here as in every chart on the site.
 *
 *   <PlatformSplit rows={platformBreakdown} rowHref={(r) => `?platform=${r.platform}`} />
 */
export function PlatformSplit({
  rows,
  rowHref,
  ariaLabel = "Views by platform",
}: {
  rows: PlatformSplitRow[];
  /** Makes each platform's name a link (a filtered list of its posts). */
  rowHref?: (row: PlatformSplitRow) => string | undefined;
  ariaLabel?: string;
}) {
  const ordered = [...rows].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  const colors = distinctPlatformColors(ordered.map((r) => r.platform));
  const total = ordered.reduce((sum, r) => sum + (r.views ?? 0), 0);

  return (
    <div className="cc-split-wrap">
      <ul className="cc-split" aria-label={ariaLabel}>
        {ordered.map((row, i) => {
          const share = total > 0 && row.views !== null ? row.views / total : null;
          const href = rowHref?.(row);
          const label = (
            <>
              <span className="cc-split-dot" aria-hidden="true" />
              {platformLabel(row.platform)}
            </>
          );
          return (
            <li key={row.platform} className="cc-split-row" style={{ "--cc-split-color": colors[i] } as CSSProperties}>
              {href ? (
                <Link href={href} className="cc-split-label">
                  {label}
                </Link>
              ) : (
                <span className="cc-split-label">{label}</span>
              )}
              <span className="cc-split-track" aria-hidden="true">
                <span className="cc-split-fill" style={{ width: `${(share ?? 0) * 100}%` }} />
              </span>
              <span className="cc-split-value" title={row.views === null ? "No view count read yet" : undefined}>
                {row.views === null ? "—" : formatFull(row.views)}
              </span>
              <span className="cc-split-meta">
                {share === null ? "" : `${shareText(share)} · `}
                {formatFull(row.posts)} {row.posts === 1 ? "post" : "posts"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
