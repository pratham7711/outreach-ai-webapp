import { formatFull, platformLabel } from "@/lib/format";

export type PlatformChipLink = {
  platform: string;
  handle: string;
  url?: string | null;
  followersCount?: number | null;
  averageViews?: number | null;
};

/**
 * One chip per account a creator has: "TikTok · 50,000". Each opens the
 * account; the label is text, never an icon alone, so it reads to a screen
 * reader and to someone who does not know every platform's logo.
 */
export default function PlatformChips({ links, max }: { links: PlatformChipLink[]; max?: number }) {
  const shown = max ? links.slice(0, max) : links;
  const hidden = links.length - shown.length;
  return (
    <span className="cc-platform-chips">
      {shown.map((l) => {
        const label = platformLabel(l.platform);
        const count = l.followersCount ? ` · ${formatFull(l.followersCount)}` : "";
        const title = [
          `${label} @${l.handle}`,
          l.followersCount ? `${formatFull(l.followersCount)} followers` : null,
          l.averageViews ? `${formatFull(l.averageViews)} avg views` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return l.url ? (
          <a
            key={`${l.platform}:${l.handle}`}
            className="cc-platform-chip"
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            onClick={(e) => e.stopPropagation()}
          >
            {label}
            {count}
          </a>
        ) : (
          <span key={`${l.platform}:${l.handle}`} className="cc-platform-chip" title={title}>
            {label}
            {count}
          </span>
        );
      })}
      {hidden > 0 && <span className="cc-platform-chip cc-platform-chip-more">+{hidden}</span>}
    </span>
  );
}
