"use client";

import { useState } from "react";
import { ImageOff, Image as ImageIcon } from "lucide-react";
import { imgSrc } from "@/lib/postMedia";

/**
 * The full-bleed cover behind a post card.
 *
 * This used to be a CSS `background-image` on the card's own anchor, and the
 * card's only fallback was gated on the URL being absent. A CDN cover that the
 * platform has stopped serving is not absent -- the row still holds a URL, the
 * proxy answers 502 (upstream 403 on an expired signature) or 404 (an entirely
 * transparent image), and a background-image has no onError -- so the card
 * painted a bare --cc-bg rectangle with the metric gradient floating on top of
 * nothing. MEASURED 2026-09-15: 22 of the 88 covers on the PARA PARA posts tab.
 *
 * An <img> is the whole fix. It covers the frame exactly as the background did,
 * and it tells us when the fetch failed, which is the difference between "this
 * post has no thumbnail" and "this post's thumbnail is gone" -- the same two
 * states PostMedia already distinguishes in the list view.
 */
export default function PostCover({
  thumbnailUrl,
  width,
  height,
  alt,
}: {
  thumbnailUrl: string | null | undefined;
  width: number;
  height: number;
  alt?: string | null;
}) {
  const [broken, setBroken] = useState(false);
  const src = imgSrc(thumbnailUrl, width, height);

  if (!src || broken) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--cc-bg)",
          color: "var(--cc-text-subtle)",
        }}
        title={broken ? "This post's thumbnail is no longer available" : "No thumbnail stored for this post"}
      >
        {broken ? <ImageOff size={40} aria-hidden="true" /> : <ImageIcon size={40} aria-hidden="true" />}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ? alt.slice(0, 60) : ""}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  );
}
