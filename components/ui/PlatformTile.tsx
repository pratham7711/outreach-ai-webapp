import { PlatformGlyph } from "@/components/ui/PlatformGlyph";

const BRAND: Record<string, string> = {
  TIKTOK: "var(--cc-brand-tiktok)",
  INSTAGRAM: "var(--cc-brand-instagram)",
  YOUTUBE: "var(--cc-brand-youtube)",
  FACEBOOK: "var(--cc-brand-facebook)",
  THREADS: "var(--cc-brand-threads)",
  TWITTER: "var(--cc-brand-twitter)",
};

/**
 * A platform's mark in its own colour: white glyph on the brand fill, in a
 * rounded square. Used where a card or list item is about one platform, so the
 * platform reads before its name does. A platform without a brand fill falls
 * back to the neutral tile.
 */
export function PlatformTile({
  platform,
  size = 40,
  className,
}: {
  platform: string;
  size?: number;
  className?: string;
}) {
  const key = platform?.toUpperCase();
  const fill = BRAND[key];
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: size,
        height: size,
        borderRadius: Math.round(size / 4),
        background: fill ?? "var(--cc-bg)",
        color: fill ? "var(--cc-overlay-ink-text)" : "var(--cc-text)",
        border: fill ? "1px solid transparent" : "1px solid var(--cc-border)",
        boxShadow: fill ? "0 1px 2px color-mix(in srgb, var(--cc-shadow-ink) 18%, transparent)" : undefined,
      }}
    >
      <PlatformGlyph platform={key} size={Math.round(size * 0.5)} />
    </span>
  );
}
