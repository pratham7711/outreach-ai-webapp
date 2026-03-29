"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Modal, Input, EmptyState, Card, Badge, LoadingSpinner } from "@pratham7711/ui";

interface MediaKit {
  id: string;
  title: string;
  slug: string;
  shareToken: string;
  isPublic: boolean;
  creatorIds: string[];
  createdAt: string;
}

export default function MediaKitsPage() {
  const [kits, setKits] = useState<MediaKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  async function fetchKits() {
    const res = await fetch("/api/media-kits");
    if (res.ok) setKits(await res.json());
    setLoading(false);
  }

  useEffect(() => { fetchKits(); }, []);

  async function createKit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/media-kits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, creatorIds: [] }),
    });
    if (res.ok) {
      setTitle("");
      setOpen(false);
      await fetchKits();
    }
    setCreating(false);
  }

  async function deleteKit(id: string) {
    if (!confirm("Delete this media kit?")) return;
    await fetch(`/api/media-kits/${id}`, { method: "DELETE" });
    await fetchKits();
  }

  return (
    <div className="cc-page-content">
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Media Kits</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Build and share creator media kits</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setOpen(true)}>
          New Media Kit
        </Button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <LoadingSpinner size={24} />
        </div>
      ) : kits.length === 0 ? (
        <EmptyState
          icon="📁"
          title="No media kits yet"
          description="Create a media kit to share creator profiles"
          action={
            <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setOpen(true)}>
              New Media Kit
            </Button>
          }
        />
      ) : (
        <Card variant="outlined" noPadding>
          <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--cc-hover-bg)" }}>
                {["Title", "Creators", "Created", "Visibility", ""].map((h, i) => (
                  <th key={i} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--cc-text-muted)", padding: "12px 20px", textAlign: "left", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kits.map((k) => (
                <tr key={k.id} className="cc-table-row" style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td style={{ padding: "12px 20px", fontWeight: 500, color: "var(--cc-text)" }}>{k.title}</td>
                  <td style={{ padding: "12px 20px", color: "var(--cc-text-muted)" }}>{k.creatorIds.length} creator{k.creatorIds.length !== 1 ? "s" : ""}</td>
                  <td style={{ padding: "12px 20px", color: "var(--cc-text-muted)" }}>{new Date(k.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: "12px 20px" }}>
                    <Badge variant={k.isPublic ? "success" : "neutral"} size="sm">
                      {k.isPublic ? "Public" : "Private"}
                    </Badge>
                  </td>
                  <td style={{ padding: "12px 20px", textAlign: "right" }}>
                    <Button variant="danger" size="sm" onClick={() => deleteKit(k.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create Media Kit"
        size="md"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={creating}
              onClick={() => {
                document.getElementById("kit-form")?.dispatchEvent(
                  new Event("submit", { cancelable: true, bubbles: true })
                );
              }}
            >
              Create
            </Button>
          </div>
        }
      >
        <form onSubmit={createKit} id="kit-form">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summer Campaign Kit"
            required
          />
        </form>
      </Modal>
    </div>
  );
}
