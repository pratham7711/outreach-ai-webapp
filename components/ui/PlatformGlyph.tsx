"use client";

import { AtSign, Facebook, Ghost, Instagram, Linkedin, Pin, Twitch, Twitter, Youtube } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The platform's own mark, at the size the caller asks for.
 *
 * Lucide covers every platform we carry except TikTok and Threads, which it
 * dropped along with the rest of its brand set, so those two are inline paths.
 * They are drawn filled while the lucide marks are stroked -- that is not an
 * inconsistency to fix: it is how each brand draws itself, and it is what the
 * reference renders.
 *
 * Sized in `em` off the caller's font-size rather than a fixed px, so a chip
 * that changes type size keeps its glyph in proportion without a second token.
 */
const LUCIDE: Partial<Record<string, LucideIcon>> = {
  INSTAGRAM: Instagram,
  YOUTUBE: Youtube,
  TWITTER: Twitter,
  FACEBOOK: Facebook,
  TWITCH: Twitch,
  LINKEDIN: Linkedin,
  PINTEREST: Pin,
  SNAPCHAT: Ghost,
};

function TikTokMark({ size }: { size: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.5 3c.3 2.1 1.5 3.4 3.5 3.6v2.3c-1.2.1-2.3-.2-3.5-.9v5.6c0 4.4-3.6 6.7-6.9 5.6-2.4-.8-3.7-3-3.5-5.3.2-2.4 2.1-4.2 4.6-4.4.4 0 .8 0 1.2.1v2.4a3.7 3.7 0 0 0-1.4-.1c-1.2.2-2 1.2-1.9 2.4.1 1.1 1 2 2.2 2 1.3 0 2.3-1 2.3-2.4V3h3.4Z" />
    </svg>
  );
}

function ThreadsMark({ size }: { size: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.2 22h-.1c-3 0-5.3-1-6.9-3C3.8 17.3 3 14.9 3 12s.8-5.3 2.3-7C6.8 3 9.1 2 12.1 2h.1c2.3 0 4.2.6 5.7 1.7 1.4 1.1 2.4 2.6 2.9 4.6l-2 .6c-.9-3.3-3.2-5-6.7-5-2.3 0-4.1.8-5.2 2.3C5.8 7.7 5.2 9.7 5.2 12s.6 4.3 1.7 5.8c1.1 1.5 2.9 2.2 5.2 2.2 2.1 0 3.5-.5 4.4-1.4.9-.9 1.3-2 1.3-3.2 0-.8-.2-1.5-.6-2.1a4 4 0 0 0-1.3-1.2c-.2 1.5-.7 2.7-1.5 3.5-.9.9-2 1.3-3.4 1.3-1.1 0-2-.3-2.7-.9a2.9 2.9 0 0 1-1-2.3c0-1 .4-1.9 1.3-2.5.8-.6 2-.9 3.4-.9.8 0 1.6.1 2.3.2 0-.6-.3-1.1-.7-1.5-.4-.4-1-.6-1.8-.6-1 0-1.8.4-2.3 1.2l-1.7-1.1c.9-1.4 2.2-2.1 4-2.1 1.4 0 2.5.4 3.3 1.3.7.8 1.1 1.8 1.2 3.1 1.9.9 3 2.6 3 4.9 0 1.8-.6 3.4-1.9 4.6-1.3 1.2-3.2 1.8-5.5 1.8Zm-1.9-8.7c-.8 0-1.4.2-1.8.5-.4.3-.5.6-.5 1 0 .3.1.6.4.8.3.2.7.4 1.2.4.8 0 1.4-.2 1.8-.7.4-.5.7-1.3.8-2.2-.6-.1-1.2-.2-1.9-.2Z" />
    </svg>
  );
}

export function PlatformGlyph({
  platform,
  size = "1.5em",
  className,
}: {
  platform: string;
  size?: number | string;
  className?: string;
}) {
  const key = platform?.toUpperCase();
  const Icon = key === "TIKTOK" ? TikTokMark : key === "THREADS" ? ThreadsMark : (LUCIDE[key] ?? AtSign);

  /* The size lands on the wrapper as CSS and the mark fills it, because a CSS
     variable is not a valid SVG length -- passed as width/height it is dropped
     silently and every glyph renders at lucide's 24px default. */
  return (
    <span
      className={className}
      aria-label={platform}
      role="img"
      style={{ display: "inline-flex", flex: "none", width: size, height: size }}
    >
      <Icon size="100%" />
    </span>
  );
}
