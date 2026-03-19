"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Media Kits</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Build and share creator media kits</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>New Media Kit</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Media Kit</DialogTitle>
            </DialogHeader>
            <form onSubmit={createKit} className="space-y-4 mt-2">
              <div className="space-y-1">
                <Label htmlFor="kit-title">Title</Label>
                <Input
                  id="kit-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Summer Campaign Kit"
                  required
                />
              </div>
              <Button type="submit" disabled={creating} className="w-full">
                {creating ? "Creating..." : "Create"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Loading...</p>
      ) : kits.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>No media kits yet. Create one to get started.</p>
      ) : (
        <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Title</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Creators</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Created</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Visibility</th>
                <th style={{ padding: "12px 20px" }}></th>
              </tr>
            </thead>
            <tbody>
              {kits.map((k) => (
                <tr key={k.id} style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td style={{ padding: "12px 20px", fontWeight: 500, color: "var(--cc-text)" }}>{k.title}</td>
                  <td style={{ padding: "12px 20px", color: "var(--cc-text-muted)" }}>
                    {k.creatorIds.length} creator{k.creatorIds.length !== 1 ? "s" : ""}
                  </td>
                  <td style={{ padding: "12px 20px", color: "var(--cc-text-muted)" }}>
                    {new Date(k.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "12px 20px" }}>
                    <span
                      style={{
                        fontSize: 12, padding: "4px 8px", borderRadius: 9999, fontWeight: 500,
                        background: k.isPublic ? "#dcfce7" : "#F3F4F6",
                        color: k.isPublic ? "#16a34a" : "var(--cc-text-muted)",
                      }}
                    >
                      {k.isPublic ? "Public" : "Private"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 20px", textAlign: "right" }}>
                    <button
                      onClick={() => deleteKit(k.id)}
                      style={{ fontSize: 12, color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
