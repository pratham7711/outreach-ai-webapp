"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Lock, AlertTriangle, Folder } from "lucide-react";
import { Button, Modal, Input, EmptyState, Card, Badge, LoadingSpinner } from "@pratham7711/ui";
import { formatDateAbs } from "@/lib/format";

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
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  async function fetchKits() {
    try {
      const res = await fetch("/api/media-kits");
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        setKits([]);
        setLoading(false);
        return;
      }
      if (res.ok) {
        setFeatureDisabled(false);
        setError(null);
        setKits(await res.json());
      } else {
        setError("We couldn't load media kits right now.");
      }
    } catch {
      setError("We couldn't load media kits right now.");
    }
    setLoading(false);
  }

  useEffect(() => { fetchKits(); }, []);

  async function createKit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/media-kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, creatorIds: [] }),
      });
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        setOpen(false);
        setCreating(false);
        return;
      }
      if (res.ok) {
        setTitle("");
        setOpen(false);
        await fetchKits();
      } else {
        setError("We couldn't create that media kit right now.");
      }
    } catch {
      setError("We couldn't create that media kit right now.");
    }
    setCreating(false);
  }

  async function deleteKit(id: string) {
    if (!confirm("Delete this media kit?")) return;
    try {
      const res = await fetch(`/api/media-kits/${id}`, { method: "DELETE" });
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        return;
      }
      if (!res.ok) {
        setError("We couldn't delete that media kit right now.");
        return;
      }
      await fetchKits();
    } catch {
      setError("We couldn't delete that media kit right now.");
    }
  }

  return (
    <div className="rsp-page">
      <div className="rsp-header">
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
      ) : featureDisabled ? (
        <Card variant="outlined" noPadding>
          <div style={{ padding: 24 }}>
            <EmptyState
              icon={<Lock size={32} color="var(--cc-text-subtle)" />}
              title="Media kits are disabled"
              description="Enable the media kits feature in Billing to create and manage shareable media kits."
              action={
                <Link
                  href="/settings/billing"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: "var(--cc-primary)",
                    color: "white",
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Open Billing
                </Link>
              }
            />
          </div>
        </Card>
      ) : error ? (
        <Card variant="outlined" noPadding>
          <div style={{ padding: 24 }}>
            <EmptyState
              icon={<AlertTriangle size={32} color="var(--cc-text-subtle)" />}
              title="Media kits couldn't load"
              description={error}
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    fetchKits();
                  }}
                >
                  Try Again
                </Button>
              }
            />
          </div>
        </Card>
      ) : kits.length === 0 ? (
        <EmptyState
          icon={<Folder size={32} color="var(--cc-text-subtle)" />}
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
          <div className="rsp-table-wrap">
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
                  <td style={{ padding: "12px 20px", color: "var(--cc-text-muted)" }}>{formatDateAbs(k.createdAt)}</td>
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
          </div>
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
