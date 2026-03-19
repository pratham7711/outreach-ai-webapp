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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Media Kits</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Build and share creator media kits
          </p>
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
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : kits.length === 0 ? (
        <p className="text-muted-foreground text-sm">No media kits yet. Create one to get started.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Title</th>
                <th className="text-left px-4 py-3 font-medium">Creators</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="text-left px-4 py-3 font-medium">Visibility</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {kits.map((k) => (
                <tr key={k.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{k.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {k.creatorIds.length} creator{k.creatorIds.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        k.isPublic
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {k.isPublic ? "Public" : "Private"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteKit(k.id)}
                      className="text-xs text-destructive hover:underline"
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
