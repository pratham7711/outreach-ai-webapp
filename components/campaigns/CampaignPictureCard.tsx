"use client";

import { useState } from "react";
import { toast } from "sonner";
import { isUploadedThumbnailUrl } from "@/lib/campaigns/uploadedPicture";
import { ThumbnailDrop, deleteCampaignThumbnail, prepareThumbnail, uploadCampaignThumbnail } from "./ThumbnailDrop";

/**
 * The campaign's picture on the Edit tab: what it shows now, and where that
 * came from. Changes save straight away, like the sound card below it.
 */
export function CampaignPictureCard({
  campaignId,
  thumbnailUrl: initialThumbnailUrl,
  hasSound,
  version,
}: {
  campaignId: string;
  thumbnailUrl: string | null;
  hasSound: boolean;
  /** The campaign's updatedAt, so a picture changed elsewhere is asked for again. */
  version: string;
}) {
  /* Kept here rather than reloading the campaign: a reload resets the Edit
     form above, and would throw away anything typed there but not saved. */
  const [thumbnailUrl, setThumbnailUrl] = useState(initialThumbnailUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bust, setBust] = useState(0);

  const uploaded = isUploadedThumbnailUrl(thumbnailUrl, campaignId);
  const stored = `/api/campaigns/${encodeURIComponent(campaignId)}/thumbnail?w=192&v=${encodeURIComponent(version)}.${bust}`;

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareThumbnail(file);
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      if (prepared.picture.preview) URL.revokeObjectURL(prepared.picture.preview);
      const saved = await uploadCampaignThumbnail(campaignId, prepared.picture.blob);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setThumbnailUrl(saved.thumbnailUrl);
      setBust((b) => b + 1);
      toast.success("Picture saved. It shows on the campaigns list and on client links.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await deleteCampaignThumbnail(campaignId);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setThumbnailUrl(null);
      setBust((b) => b + 1);
      toast.success(hasSound ? "Picture removed. The sound's cover art is shown again." : "Picture removed.");
    } finally {
      setBusy(false);
    }
  };
  let caption: string | undefined;
  if (uploaded) {
    caption = hasSound
      ? "Your picture, shown on the campaigns list and on client links instead of the sound's cover."
      : "Your picture, shown on the campaigns list and on client links.";
  } else if (thumbnailUrl) {
    caption = hasSound
      ? "The sound's cover art. Upload a picture to use your own instead."
      : "A picture saved from a link. Upload one to replace it.";
  }

  return (
    <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24 }}>
      <ThumbnailDrop
        asCard
        hint={
          hasSound
            ? "Optional. JPG, PNG, WebP or HEIC. Until you add one, the sound's cover art is used."
            : "Optional. JPG, PNG, WebP or HEIC. Without one, the campaign shows its initials."
        }
        preview={caption !== undefined ? stored : null}
        caption={caption}
        busy={busy}
        error={error}
        onFile={pick}
        onRemove={uploaded || (thumbnailUrl && !hasSound) ? remove : undefined}
      />
    </div>
  );
}
