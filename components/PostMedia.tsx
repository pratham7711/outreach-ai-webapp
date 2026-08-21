"use client";

import { useState } from "react";
import { Play, ExternalLink, ImageOff } from "lucide-react";
import { mediaUrl, embedSrcFor } from "@/lib/postMedia";

/**
 * A post's picture, and the post itself.
 *
 * Every surface that lists posts had the thumbnail URL in hand and rendered
 * nothing -- 18,665 stored thumbnails, none on screen. This shows the still and,
 * where the platform gives us a player, plays the post in place instead of
 * bouncing the user to TikTok in a new tab.
 */

type Props = {
  platform: string;
  platformPostId?: string | null;
  postUrl?: string | null;
  thumbnailUrl?: string | null;
  caption?: string | null;
  width?: number;
  height?: number;
  radius?: number;
};

export default function PostMedia({
  platform,
  platformPostId,
  postUrl,
  thumbnailUrl,
  caption,
  width = 56,
  height = 74,
  radius = 8,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const thumb = mediaUrl(thumbnailUrl);
  const embed = embedSrcFor(platform, platformPostId, postUrl);
  const href = postUrl ?? undefined;

  const frame: React.CSSProperties = {
    position: "relative",
    width,
    height,
    borderRadius: radius,
    overflow: "hidden",
    flexShrink: 0,
    border: "1px solid var(--cc-border)",
    background: "var(--cc-hover-bg)",
    padding: 0,
    display: "block",
  };

  const inner = thumb ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumb}
      alt={caption ? caption.slice(0, 60) : "Post thumbnail"}
      loading="lazy"
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  ) : (
    <span
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--cc-text-subtle)",
      }}
      title="No thumbnail stored for this post"
    >
      <ImageOff size={16} />
    </span>
  );

  // No player for this platform: the still becomes a plain outbound link.
  if (!embed) {
    if (!href) return <span style={frame}>{inner}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={frame} title="Open post" aria-label="Open post">
        {inner}
        <span style={overlayStyle}>
          <ExternalLink size={14} color="#fff" />
        </span>
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // These sit inside table rows that navigate on click.
          e.preventDefault();
          e.stopPropagation();
          setPlaying(true);
        }}
        style={{ ...frame, cursor: "pointer" }}
        aria-label="Play post"
        title="Play post"
      >
        {inner}
        <span style={overlayStyle}>
          <Play size={15} color="#fff" fill="#fff" />
        </span>
      </button>

      {playing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Post player"
          onClick={(e) => {
            e.stopPropagation();
            setPlaying(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: platform === "YOUTUBE" ? 900 : 420,
              aspectRatio: platform === "YOUTUBE" ? "16 / 9" : "9 / 16",
              maxHeight: "88vh",
              background: "#000",
              borderRadius: 12,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <iframe
              src={embed}
              title={caption ?? "Post"}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            />
          </div>
        </div>
      )}
    </>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.28)",
};
