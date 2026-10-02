"use client";

import { useState, useSyncExternalStore } from "react";

type Size = "sm" | "md" | "lg";

/** Rendered box per size, doubled for retina and snapped to a proxy width. */
const REQUEST_PX: Record<Size, number> = { sm: 64, md: 96, lg: 128 };

export const avatarRequestPx = (size: Size) => REQUEST_PX[size];

/** The picture for a creator id, served from CreatorAvatar. */
export function creatorAvatarSrc(
  creatorId: string | null | undefined,
  size: Size = "sm",
  version?: string | null
): string | undefined {
  if (!creatorId) return undefined;
  const v = version ? `&v=${encodeURIComponent(version)}` : "";
  return `/api/creators/${encodeURIComponent(creatorId)}/avatar?w=${REQUEST_PX[size]}${v}`;
}

/**
 * A creator's profile picture wherever their name or handle is shown.
 *
 * Takes the id, not a URL: the stored picture outlives the signed CDN link the
 * platform handed out, so asking by id is what keeps it from rotting. Falls
 * back to initials when there is no picture -- Avatar handles the 404.
 */
export default function CreatorAvatar({
  id,
  name,
  size = "sm",
  className,
  src,
  version,
}: {
  id: string | null | undefined;
  name: string;
  size?: Size;
  className?: string;
  /** A signed-out page's own picture route, in place of the session-scoped one. */
  src?: string;
  /**
   * What the page knows is stored. A string lands in the URL, so a picture
   * stored since the browser cached this creator's 404 is asked for afresh;
   * null means there is nothing to fetch, and the initials show with no
   * request at all. Left out, the picture is asked for as before.
   */
  version?: string | null;
}) {
  /* The src is set only after hydration. In server-rendered HTML the browser
     starts the request before React attaches onError, so a 404 for a creator
     with no picture left a broken-image icon instead of initials. A component
     mounted by a client-side navigation is already past hydration, so it gets
     its src on the first render instead of rendering twice. */
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  /* The src that failed, rather than a flag: a new src gets its own attempt
     without remounting the avatar to clear it. */
  const [failed, setFailed] = useState<string | null>(null);
  const url = hydrated && version !== null ? (src ?? creatorAvatarSrc(id, size, version)) : undefined;
  /* The markup and classes of the design system's Avatar, which has no way to
     ask for a lazy image: a 300-creator list asked the server for all 300
     pictures at once, where only the rows on screen need one. */
  return (
    <span className={`ui-avatar ui-avatar-${size} ${className ?? ""}`}>
      {url && failed !== url ? (
        // eslint-disable-next-line @next/next/no-img-element -- the route resizes and caches it; next/image would proxy it a second time
        <img src={url} alt={name} loading="lazy" decoding="async" onError={() => setFailed(url)} />
      ) : (
        <span aria-label={name}>{name ? initials(name) : "?"}</span>
      )}
    </span>
  );
}

const noSubscription = () => () => {};

/** The design system Avatar's initials: first two letters of one word, else first and last initials. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length === 1
    ? words[0].slice(0, 2).toUpperCase()
    : (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
