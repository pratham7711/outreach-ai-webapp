"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Unlink } from "lucide-react";

export type AttachableCampaign = { id: string; title: string; songId: string | null };

/**
 * Attaching and detaching is the only way a song gathers campaigns, so it lives
 * on the song page rather than buried in campaign settings. Detach is offered
 * too — a campaign standing alone is a supported state, not a broken one.
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

  const attached = campaigns.filter((c) => c.songId === songId);
  const available = campaigns.filter((c) => c.songId !== songId);

  async function setSong(campaignId: string, nextSongId: string | null) {
    setBusy(campaignId);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId: nextSongId }),
      });
      if (!res.ok) {
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
        <select
          aria-label="Campaign to attach"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          style={{
            flex: 1, minWidth: 180, background: "var(--cc-card)",
            border: "1px solid var(--cc-border)", borderRadius: 8,
            padding: "8px 10px", fontSize: 13, color: "var(--cc-text)",
          }}
        >
          <option value="">Attach a campaign…</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}{c.songId ? " (on another song)" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!picked || busy !== null}
          onClick={() => picked && setSong(picked, songId)}
          style={{
            background: picked ? "var(--cc-primary)" : "var(--cc-border)",
            color: picked ? "white" : "var(--cc-text-muted)",
            border: "none", borderRadius: 8, padding: "8px 14px",
            fontSize: 13, fontWeight: 600, cursor: picked ? "pointer" : "not-allowed",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          <Link2 size={14} aria-hidden="true" /> Attach
        </button>
      </div>

      {attached.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {attached.map((c) => (
            <span
              key={c.id}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                borderRadius: 999, padding: "4px 6px 4px 12px", fontSize: 12,
                color: "var(--cc-text)",
              }}
            >
              {c.title}
              <button
                type="button"
                aria-label={`Detach ${c.title}`}
                disabled={busy === c.id}
                onClick={() => setSong(c.id, null)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--cc-text-muted)", display: "inline-flex", padding: 2,
                }}
              >
                <Unlink size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: "#DC2626" }}>{error}</p>}
    </div>
  );
}
