"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Unlink } from "lucide-react";
import { Dropdown } from "@/components/ds";

export type AttachableCampaign = { id: string; title: string; songId: string | null };

async function patchCampaignSong(campaignId: string, songId: string | null): Promise<boolean> {
  const res = await fetch(`/api/campaigns/${campaignId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ songId }),
  });
  return res.ok;
}

/** Detach sits on the campaign's own row in the song's list, so each
 *  campaign is listed once, not again as a chip above the list. */
export function DetachCampaign({ campaignId, title }: { campaignId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="cc-song-detach"
      aria-label={`Detach ${title}`}
      title={failed ? "Could not detach that campaign" : "Detach from this song"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setFailed(false);
        try {
          if (await patchCampaignSong(campaignId, null)) router.refresh();
          else setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
      style={{
        background: "none", border: "none", cursor: "pointer", flexShrink: 0,
        color: failed ? "var(--cc-danger-fg)" : "var(--cc-text-muted)",
        display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 8, borderRadius: 999,
      }}
    >
      <Unlink size={14} aria-hidden="true" />
    </button>
  );
}

/**
 * Attaching and detaching is the only way a song gathers campaigns, so it lives
 * on the song page rather than buried in campaign settings. Detach is on each
 * campaign's row (DetachCampaign) — a campaign standing alone is a supported
 * state, not a broken one.
 */
export default function AttachCampaigns({
  songId,
  campaigns,
}: {
  songId: string;
  campaigns: AttachableCampaign[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");

  const available = campaigns.filter((c) => c.songId !== songId);

  async function setSong(campaignId: string, nextSongId: string | null) {
    setBusy(campaignId);
    setError(null);
    try {
      if (!(await patchCampaignSong(campaignId, nextSongId))) {
        setError("Could not update that campaign.");
        return;
      }
      setPicked("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <Dropdown
            ariaLabel="Campaign to attach"
            align="left"
            fullWidth
            minWidth={180}
            value={picked}
            onChange={setPicked}
            options={[
              { value: "", label: "Attach a campaign\u2026" },
              ...available.map((c) => ({
                value: c.id,
                label: `${c.title}${c.songId ? " (on another song)" : ""}`,
              })),
            ]}
          />
        </div>
        <button
          type="button"
          disabled={!picked || busy !== null}
          onClick={() => picked && setSong(picked, songId)}
          style={{
            background: picked ? "var(--cc-primary)" : "var(--cc-border)",
            color: picked ? "var(--cc-on-primary)" : "var(--cc-text-muted)",
            border: "none", borderRadius: 8, padding: "8px 14px",
            fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", cursor: picked ? "pointer" : "not-allowed",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          <Link2 size={14} aria-hidden="true" /> Attach
        </button>
      </div>

      {error && <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-danger-fg)" }}>{error}</p>}
    </div>
  );
}
