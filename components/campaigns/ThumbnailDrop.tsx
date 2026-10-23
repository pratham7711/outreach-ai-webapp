"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { ImageIcon, ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ds";
import { isHeifContainer } from "@/lib/media/heifSniff";

/**
 * The campaign's own picture: a drop zone on the new-campaign form and the
 * Edit tab. Shown ahead of a sound's cover on the campaigns list and on client
 * links (lib/campaignArtwork).
 */

/**
 * A picture ready to send. `blob` goes first; `fallback`, when there is one, is
 * the file itself, sent only if the server cannot read `blob`.
 */
export type PreparedThumbnail = {
  blob: Blob;
  fallback: Blob | null;
  /** `blob` is the file gzipped, for the server to unpack: see packUnderCap. */
  gzipped: boolean;
  /** An object URL to show before it is saved. The tile shows an icon instead when the browser cannot draw it (TIFF, HEIC outside Safari). */
  preview: string | null;
  name: string;
};

const PICK_MAX_BYTES = 50 * 1024 * 1024;
/** The route's own cap (CAMPAIGN_THUMBNAIL_UPLOAD_MAX_BYTES), under the 4.5 MB a request may carry. */
const SEND_MAX_BYTES = 4 * 1024 * 1024;
const SHRINK_TO_PX = 1024;
const HEIC_NAME = /\.(heic|heif)$/i;
/** Picture files that may arrive with no type at all, which some systems do for HEIC and SVG. */
const PICTURE_NAME = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|svg|tiff?|ico|jxl)$/i;

/** The type the file itself is sent as: the server picks its HEIC decoder by it, and sniffs everything else. */
function sendType(file: File): string {
  if (/^image\/(heic|heif)$/i.test(file.type) || HEIC_NAME.test(file.name)) return "image/heic";
  return file.type.startsWith("image/") ? file.type : "application/octet-stream";
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

/* createImageBitmap first; an <img> second, because Chrome's createImageBitmap
   refuses SVG that an <img> draws; for a HEIC too big to send as it is, libheif.
   Null when none can. */
async function decodeInBrowser(file: File): Promise<Decoded | null> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // fall through to the <img>
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    /* An SVG with no width or height has no natural size; draw it at the target size. */
    const width = img.naturalWidth || SHRINK_TO_PX;
    const height = img.naturalHeight || SHRINK_TO_PX;
    return { source: img, width, height, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
  }
  return file.size > SEND_MAX_BYTES ? decodeHeicInBrowser(file) : null;
}

/* Only Safari draws HEIC, and an iPhone photo can be over the 4 MB the server
   may be sent, so elsewhere the same libheif build the server uses is loaded
   on demand (about 1.4 MB, fetched only for such a HEIC) to shrink it here. A
   smaller HEIC is cheaper sent as it is. */
async function decodeHeicInBrowser(file: File): Promise<Decoded | null> {
  try {
    if (!isHeifContainer(new Uint8Array(await file.slice(0, 64).arrayBuffer()))) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { default: decodeHeic } = await import("heic-decode");
    const { width, height, data } = await decodeHeic({ buffer: bytes });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    return { source: canvas, width, height, release: () => undefined };
  } catch {
    return null;
  }
}

/** At most 1024px on its long side, as WebP, or null when the browser cannot make one. */
async function shrinkInBrowser(file: File): Promise<Blob | null> {
  const decoded = await decodeInBrowser(file);
  if (!decoded) return null;
  try {
    const scale = Math.min(1, SHRINK_TO_PX / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    return blob && blob.size > 0 && blob.size <= SEND_MAX_BYTES ? blob : null;
  } catch {
    return null;
  } finally {
    decoded.release();
  }
}

/* A file the browser cannot shrink and that is over the cap goes gzipped
   instead: a large TIFF or BMP is mostly uncompressed and packs well under it.
   The server unpacks it, up to its own unpacked cap. Null when it does not fit
   (a file that is already compressed, such as a big HEIC this browser could not
   decode either). */
async function packUnderCap(file: File): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const packed = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
    return packed.size <= SEND_MAX_BYTES ? new Blob([packed], { type: sendType(file) }) : null;
  } catch {
    return null;
  }
}

/**
 * Check a chosen file and get it ready to send.
 *
 * The server reads every format we know of and keeps its own 384px AVIF
 * (lib/campaigns/thumbnailCopy), so the browser's part is only to make the
 * request small: a phone photo is 3-12 MB, over the 4.5 MB a request may carry.
 * Where the browser can, it shrinks the picture to a 1024px WebP and sends
 * that, with the file itself as the fallback. Where it cannot -- Chrome draws
 * no HEIC or TIFF, nor a HEIC saved under a .jpg name, and some PNGs fail too --
 * the file goes as it is, up to the 4 MB cap, or gzipped when that brings it
 * under. Refusing at this step is what told people with an ordinary logo that it
 * was "not a picture"; only a file the browser can neither shrink nor pack under
 * the cap is refused here now.
 */
export async function prepareThumbnail(file: File): Promise<{ ok: true; picture: PreparedThumbnail } | { ok: false; error: string }> {
  if (!file.type.startsWith("image/") && !PICTURE_NAME.test(file.name)) {
    return { ok: false, error: "Choose a picture file, such as a JPG, PNG, HEIC or SVG." };
  }
  if (file.size > PICK_MAX_BYTES) return { ok: false, error: "That picture is over 50 MB." };

  const shrunk = await shrinkInBrowser(file);
  const original = file.size <= SEND_MAX_BYTES ? new Blob([file], { type: sendType(file) }) : null;
  const packed = shrunk || original ? null : await packUnderCap(file);
  const blob = shrunk ?? original ?? packed;
  if (!blob) {
    return { ok: false, error: "That picture is over 4 MB and this browser cannot shrink it. Save it as a JPG or PNG and try again." };
  }
  return {
    ok: true,
    picture: {
      blob,
      fallback: shrunk ? original : null,
      gzipped: blob === packed,
      preview: URL.createObjectURL(shrunk ?? file),
      name: file.name,
    },
  };
}

export type ThumbnailSaveResult = { ok: true; thumbnailUrl: string | null } | { ok: false; error: string };

async function putThumbnail(campaignId: string, blob: Blob, gzipped: boolean) {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/thumbnail`, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream", ...(gzipped ? { "X-Picture-Encoding": "gzip" } : {}) },
    body: blob,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}

/**
 * Save a prepared picture as the campaign's own. If the server cannot read
 * what the browser made of it, the file itself is sent instead, so a picture
 * is refused only when neither the browser nor the server can read it.
 */
export async function uploadCampaignThumbnail(
  campaignId: string,
  picture: Pick<PreparedThumbnail, "blob" | "fallback"> & { gzipped?: boolean },
): Promise<ThumbnailSaveResult> {
  try {
    let saved = await putThumbnail(campaignId, picture.blob, picture.gzipped === true);
    if (!saved.ok && picture.fallback && (saved.status === 415 || saved.status === 422)) {
      saved = await putThumbnail(campaignId, picture.fallback, false);
    }
    if (saved.ok) return { ok: true, thumbnailUrl: saved.body?.thumbnailUrl ?? null };
    return { ok: false, error: saved.body?.error ?? "The picture could not be saved." };
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
