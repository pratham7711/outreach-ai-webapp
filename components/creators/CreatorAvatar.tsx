"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@pratham7711/ui";

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
     with no picture left a broken-image icon instead of initials. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Avatar
      key={`${id ?? name}:${mounted}`}
      name={name}
      size={size}
      src={mounted && version !== null ? (src ?? creatorAvatarSrc(id, size, version)) : undefined}
      className={className}
    />
  );
}
