import { formatCompact, formatFull, platformLabel } from "@/lib/format";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { handleProblemText, type HandleProblem } from "@/lib/creators/handleCheck";
import { followersValue, isUnknownMetric } from "@/lib/creators/metricValue";

export type PlatformChipLink = {
  platform: string;
  handle: string;
  url?: string | null;
  followersCount?: number | null;
  averageViews?: number | null;
  /** The platform could not find this account; its chip says so instead of a count. */
  problem?: HandleProblem | null;
  /** When the profile refresh last read this account, so a missing count can say why. */
  refreshedAt?: string | null;
};

/**
 * One chip per account a creator has: "TikTok · 50,000". Each opens the
 * account; the label is text, never an icon alone, so it reads to a screen
 * reader and to someone who does not know every platform's logo.
 *
 * `compact` is for a card or a table cell, where four accounts have to fit on
 * one line: the platform's mark and "50K". The name and the exact count move to
 * the accessible name and the tooltip rather than going missing, and an
 * account with no count shows its name beside the mark instead.
 */
export default function PlatformChips({
  links,
  max,
  compact = false,
}: {
  links: PlatformChipLink[];
  max?: number;
  compact?: boolean;
}) {
  const shown = max ? links.slice(0, max) : links;
  const hidden = links.length - shown.length;
  return (
    <span className="cc-platform-chips" data-compact={compact || undefined}>
      {shown.map((l) => {
        const label = platformLabel(l.platform);
        /* A chip with no count shows the platform's name rather than a 0, and
           its tooltip says why the count is missing (plan A1). */
        const followers = followersValue(l.followersCount, { attemptedAt: l.refreshedAt });
        const title = l.problem
          ? handleProblemText(l.platform, l.handle, l.problem)
          : [
              `${label} @${l.handle}`,
              isUnknownMetric(followers) ? `followers unknown: ${followers.reason}` : `${formatFull(followers)} followers`,
              l.averageViews ? `${formatFull(l.averageViews)} avg views` : null,
            ]
              .filter(Boolean)
              .join(" · ");
        const body = compact ? (
          <>
            <PlatformGlyph platform={l.platform} size="1.15em" className="cc-platform-chip-mark" />
            <span className="cc-platform-chip-text">
              {l.problem ? "Not found" : l.followersCount ? formatCompact(l.followersCount) : label}
            </span>
          </>
        ) : (
          <>
            {label}
            {l.problem ? " · not found" : l.followersCount ? ` · ${formatFull(l.followersCount)}` : ""}
          </>
        );
        const a11y = compact || l.problem ? { "aria-label": title } : {};
        const flag = l.problem ? { "data-problem": l.problem } : {};
        return l.url ? (
          <a
            key={`${l.platform}:${l.handle}`}
            className="cc-platform-chip"
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            onClick={(e) => e.stopPropagation()}
            {...a11y}
            {...flag}
          >
            {body}
          </a>
        ) : (
          <span key={`${l.platform}:${l.handle}`} className="cc-platform-chip" title={title} {...a11y} {...flag}>
            {body}
          </span>
        );
      })}
      {hidden > 0 && (
        <span className="cc-platform-chip cc-platform-chip-more" title={links.slice(shown.length).map((l) => platformLabel(l.platform)).join(", ")}>
          +{hidden}
        </span>
      )}
    </span>
  );
}
