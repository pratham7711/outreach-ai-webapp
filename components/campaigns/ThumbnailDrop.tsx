"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { ImageIcon, ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ds";

/**
 * The campaign's own picture: a drop zone on the new-campaign form and the
 * Edit tab. Shown ahead of a sound's cover on the campaigns list and on client
 * links (lib/campaignArtwork).
 */

/** A picture ready to send: shrunk in the browser where it can be decoded. */
export type PreparedThumbnail = {
  blob: Blob;
  /** An object URL to show before it is saved, or null when the browser cannot draw it (HEIC outside Safari). */
  preview: string | null;
  name: string;
};

const PICK_MAX_BYTES = 20 * 1024 * 1024;
/** The route's own cap (CAMPAIGN_THUMBNAIL_UPLOAD_MAX_BYTES); only an undecodable HEIC is sent unshrunk. */
const SEND_MAX_BYTES = 4 * 1024 * 1024;
const SHRINK_TO_PX = 1024;
const HEIC_NAME = /\.(heic|heif)$/i;

function isHeic(file: File): boolean {
  return /^image\/(heic|heif)$/i.test(file.type) || HEIC_NAME.test(file.name);
}

/**
 * Check a chosen file and shrink it to at most 1024px on its long side, as
 * WebP. A phone photo is 3-12 MB; this is what keeps it under the 4.5 MB a
 * request may carry. A file the browser cannot decode goes as it is if it is
 * HEIC (the server reads those), and is refused otherwise.
 */
export async function prepareThumbnail(file: File): Promise<{ ok: true; picture: PreparedThumbnail } | { ok: false; error: string }> {
  if (!file.type.startsWith("image/") && !HEIC_NAME.test(file.name)) {
    return { ok: false, error: "Choose a picture: JPG, PNG, WebP or HEIC." };
  }
  if (file.size > PICK_MAX_BYTES) return { ok: false, error: "That picture is over 20 MB." };

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    bitmap = null;
  }

  if (!bitmap) {
    if (!isHeic(file)) return { ok: false, error: "That file could not be read as a picture." };
    if (file.size > SEND_MAX_BYTES) return { ok: false, error: "That HEIC picture is over 4 MB. Save it as a JPG and try again." };
    return { ok: true, picture: { blob: new Blob([file], { type: "image/heic" }), preview: null, name: file.name } };
  }

  const scale = Math.min(1, SHRINK_TO_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) return { ok: false, error: "That file could not be read as a picture." };
  return { ok: true, picture: { blob, preview: URL.createObjectURL(blob), name: file.name } };
}

export type ThumbnailSaveResult = { ok: true; thumbnailUrl: string | null } | { ok: false; error: string };

/** Save a prepared picture as the campaign's own. */
export async function uploadCampaignThumbnail(campaignId: string, blob: Blob): Promise<ThumbnailSaveResult> {
  try {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/thumbnail`, {
      method: "PUT",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, thumbnailUrl: body?.thumbnailUrl ?? null };
    return { ok: false, error: body?.error ?? "The picture could not be saved." };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

/** Take the campaign's own picture away. */
export async function deleteCampaignThumbnail(campaignId: string): Promise<ThumbnailSaveResult> {
  try {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/thumbnail`, { method: "DELETE" });
    if (res.ok) return { ok: true, thumbnailUrl: null };
    const body = await res.json().catch(() => null);
    return { ok: false, error: body?.error ?? "The picture could not be removed." };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

export function ThumbnailDrop({
  label = "Campaign picture",
  asCard = false,
  hint,
  preview,
  caption,
  busy = false,
  error,
  removeLabel = "Remove",
  onFile,
  onRemove,
}: {
  label?: string;
  /** Titled like the other cards on the Edit tab rather than like a form field. */
  asCard?: boolean;
  hint: string;
  /** What to show in the filled state; null with a caption shows a placeholder tile. */
  preview: string | null;
  /** Filled-state line under the label. Undefined means the zone is empty. */
  caption?: string;
  busy?: boolean;
  error?: string | null;
  removeLabel?: string;
  onFile: (file: File) => void;
  onRemove?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const hintId = useId();
  const filled = caption !== undefined;
  const showImage = preview !== null && broken !== preview;

  const choose = () => input.current?.click();

  const drop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  const dragProps = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (!busy) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: drop,
  };

  return (
    <div>
      {asCard ? (
        <h3 style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)", margin: "0 0 16px" }}>{label}</h3>
      ) : (
        <p style={{ fontSize: "var(--cc-t-13)", fontWeight: 600, color: "var(--cc-text)", margin: "0 0 6px" }}>{label}</p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />

      {filled ? (
        <div
          {...dragProps}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: 12,
            borderRadius: 12,
            border: `1px ${dragging ? "dashed" : "solid"} ${dragging ? "var(--cc-primary)" : "var(--cc-border)"}`,
            background: dragging ? "var(--cc-primary-light)" : "var(--cc-card)",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 10,
              flexShrink: 0,
              overflow: "hidden",
              background: "var(--cc-bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--cc-text-muted)",
            }}
          >
            {showImage ? (
              /* eslint-disable-next-line @next/next/no-img-element -- an object URL or our own stored copy. */
              <img
                src={preview}
                alt=""
                width={88}
                height={88}
                onError={() => setBroken(preview)}
                style={{ width: 88, height: 88, objectFit: "cover", display: "block" }}
              />
            ) : (
              <ImageIcon size={24} aria-hidden />
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p id={hintId} style={{ margin: 0, fontSize: "var(--cc-t-13)", color: "var(--cc-text)", lineHeight: 1.45 }}>
              {caption}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <Button variant="secondary" size="sm" iconLeft={<RefreshCw size={14} />} loading={busy} disabled={busy} onClick={choose}>
                {preview === null && !onRemove ? "Choose a picture" : "Replace"}
              </Button>
              {onRemove && (
                <Button variant="ghost" size="sm" iconLeft={<Trash2 size={14} />} disabled={busy} onClick={onRemove}>
                  {removeLabel}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={choose}
          disabled={busy}
          aria-describedby={hintId}
          {...dragProps}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 18px",
            borderRadius: 12,
            border: `1.5px dashed ${dragging ? "var(--cc-primary)" : "var(--cc-text-subtle)"}`,
            background: dragging ? "var(--cc-primary-light)" : "transparent",
            color: "var(--cc-text)",
            cursor: busy ? "progress" : "pointer",
            textAlign: "left",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--cc-primary-light)",
              color: "var(--cc-primary)",
            }}
          >
            <ImagePlus size={20} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "var(--cc-t-14)", fontWeight: 600 }}>
              {busy ? "Saving the picture…" : "Drop a picture here, or choose one"}
            </span>
            <span id={hintId} style={{ display: "block", marginTop: 2, fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
              {hint}
            </span>
          </span>
        </button>
      )}

      {error && (
        <p role="alert" style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-danger-fg)", margin: "6px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}
