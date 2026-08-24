"use client";

import React from "react";
import { useState, useEffect, useCallback } from "react";
import { Card, Modal, EmptyState, Skeleton } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { FileText, ExternalLink, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatDateAbs } from "@/lib/format";

/**
 * The reference's Documents tab -- the contract, the brief, the invoice, kept
 * with the campaign they belong to.
 *
 * A document is a link rather than an upload: there is no file storage in this
 * stack, and adding one is a metered service and a budget decision. A link to
 * wherever the file already lives does the same job for nothing.
 */

type Doc = {
  id: string;
  name: string;
  fileUrl: string;
  mimeType: string | null;
  uploadedAt: string;
  uploadedBy: { name: string | null; email: string | null } | null;
};

/* text/uri-list is what a plain link records, and showing it to somebody would
   mean nothing -- so the label is dropped in that one case. */
const TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.ms-powerpoint": "Slides",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "Slides",
  "text/csv": "CSV",
  "text/plain": "Text",
  "application/zip": "Zip",
};

function typeLabel(mimeType: string | null): string | null {
  if (!mimeType || mimeType === "text/uri-list") return null;
  if (TYPE_LABELS[mimeType]) return TYPE_LABELS[mimeType];
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("video/")) return "Video";
  return null;
}

export default function DocumentsTab({ campaignId }: { campaignId: string }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/documents`);
    if (res.ok) {
      const data = await res.json();
      setDocs(Array.isArray(data.documents) ? data.documents : []);
    } else {
      setDocs([]);
      toast.error("Could not load documents");
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) {
      toast.error("A document needs a name and a link");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, url: trimmedUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Could not add it");
        return;
      }
      setName("");
      setUrl("");
      setShowAdd(false);
      await load();
      toast.success("Document added");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: Doc) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not remove it");
        return;
      }
      await load();
      toast.success("Document removed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)" }}>Documents</h2>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            Contracts, briefs and anything else that belongs with this campaign.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Document
        </Button>
      </div>

      {docs === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2, 3].map((i) => <Skeleton key={i} width="100%" height="64px" borderRadius="12px" />)}
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FileText size={32} color="var(--cc-text-subtle)" />}
          title="No documents added to this campaign!"
          description="Link the contract, the brief or the invoice so it sits with the campaign."
        />
      ) : (
        <Card noPadding>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {docs.map((doc, i) => {
              const label = typeLabel(doc.mimeType);
              const who = doc.uploadedBy?.name || doc.uploadedBy?.email;
              return (
                <li
                  key={doc.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                    borderTop: i === 0 ? "none" : "1px solid var(--cc-border)",
                  }}
                >
                  <FileText size={18} color="var(--cc-text-muted)" aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 14, fontWeight: 600, color: "var(--cc-text)",
                        textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6,
                      }}
                    >
                      {doc.name}
                      <ExternalLink size={12} color="var(--cc-text-muted)" aria-hidden="true" />
                    </a>
                    <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      {[label, who && `Added by ${who}`, formatDateAbs(doc.uploadedAt)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${doc.name}`}
                    disabled={busy}
                    onClick={() => remove(doc)}
                    style={{
                      background: "none", border: "none", cursor: busy ? "default" : "pointer",
                      color: "var(--cc-text-muted)", display: "inline-flex", padding: 4,
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {showAdd && (
        <Modal
          open
          onClose={() => setShowAdd(false)}
          title="Add Document"
          size="md"
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={add}>Add Document</Button>
            </div>
          }
        >
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 16 }}>
            Paste a link to where the document already lives — Drive, Dropbox, Notion, anywhere.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="text"
              value={name}
              aria-label="Document name"
              onChange={(e) => setName(e.target.value)}
              placeholder="Signed contract"
              style={fieldStyle}
            />
            <input
              type="url"
              value={url}
              aria-label="Document link"
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              style={fieldStyle}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)",
  fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none",
  boxSizing: "border-box",
};
