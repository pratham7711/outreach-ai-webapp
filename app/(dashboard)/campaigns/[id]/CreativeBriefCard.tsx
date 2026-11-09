"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Button, SectionCard } from "@/components/ds";

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
    <SectionCard
      className={!editing && !saved ? "cc-campaign-card-unset" : undefined}
      title="Creative brief"
      action={
        canEdit && !editing ? (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {saved ? "Edit brief" : "Write brief"}
          </Button>
        ) : editing ? (
          <span className="cc-campaign-card-actions">
            <Button variant="secondary" size="sm" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save brief"}
            </Button>
          </span>
        ) : undefined
      }
    >
      {editing ? (
        <RichTextEditor
          value={draft}
          onChange={setDraft}
          ariaLabel="Creative brief"
          placeholder="What are creators making, and what does good look like?"
        />
      ) : saved ? (
        <RichTextViewer value={saved} editable={false} minHeight={0} />
      ) : (
        <p className="cc-campaign-card-note">No brief yet.</p>
      )}
    </SectionCard>
  );
}
