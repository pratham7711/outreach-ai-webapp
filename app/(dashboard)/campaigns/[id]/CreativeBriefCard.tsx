"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Card } from "@pratham7711/ui";

/* Tiptap and prosemirror are ~152 KB gzipped, and a static import put them in
   the first load of every campaign section, though only Overview shows a brief.
   Loaded on demand instead. The placeholder is the box the editor itself draws
   before it mounts (RichTextEditor's `!editor` branch), at the same height, so
   nothing moves when the chunk arrives. Two wrappers over one import: the
   loading slot cannot see props, and the read-only view starts shorter. */
const loadEditor = () => import("@/components/RichTextEditor");
function EditorBox({ minHeight }: { minHeight: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--cc-border)", borderRadius: 10,
        minHeight: minHeight + 37, background: "var(--cc-card)",
      }}
    />
  );
}
const RichTextEditor = dynamic(loadEditor, { ssr: false, loading: () => <EditorBox minHeight={140} /> });
const RichTextViewer = dynamic(loadEditor, { ssr: false, loading: () => <EditorBox minHeight={0} /> });

/**
 * The campaign's creative brief, on the Overview where the reference puts it.
 *
 * The brief used to be shown here and nowhere written -- the CreativeBrief
 * table had a version counter that nothing incremented. The card now reads and
 * writes it, and it shows even when the brief is empty, because a card that
 * only appears once a brief exists leaves nowhere to write the first one.
 *
 * Read mode renders through the same editor as write mode, not a second path,
 * so the schema that decides what formatting is allowed is the same one in both.
 */

export default function CreativeBriefCard({
  campaignId, initialContent, canEdit = true,
}: {
  campaignId: string;
  initialContent: string;
  canEdit?: boolean;
}) {
  const [saved, setSaved] = useState(initialContent);
  const [draft, setDraft] = useState(initialContent);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/brief`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to save the brief");
        return;
      }
      // The server decides what an empty brief is, so the saved copy comes back
      // from it rather than from what was typed.
      const body = await res.json();
      setSaved(body.content);
      setDraft(body.content);
      setEditing(false);
      toast.success("Brief saved");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(saved);
    setEditing(false);
  };

  return (
    <Card variant="outlined" className="cc-overview-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="cc-panel-title">Creative Brief</span>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)",
              background: "var(--cc-card)", border: "1.5px solid var(--cc-primary)",
              color: "var(--cc-primary)", cursor: "pointer",
            }}
          >
            {saved ? "Edit Brief" : "Write Brief"}
          </button>
        )}
        {editing && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)",
                background: "transparent", border: "1px solid var(--cc-border)",
                color: "var(--cc-text-muted)", cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)",
                border: "none", color: saving ? "white" : "var(--cc-on-primary)", cursor: saving ? "not-allowed" : "pointer",
                background: saving ? "var(--cc-border)" : "var(--cc-primary)",
              }}
            >
              {saving ? "Saving..." : "Save Brief"}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <RichTextEditor
          value={draft}
          onChange={setDraft}
          ariaLabel="Creative Brief"
          placeholder="What are creators making, and what does good look like?"
        />
      ) : saved ? (
        <RichTextViewer value={saved} editable={false} minHeight={0} />
      ) : (
        <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)" }}>
          No brief yet.
        </p>
      )}
    </Card>
  );
}
