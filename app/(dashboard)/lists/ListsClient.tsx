"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Users, Search, ClipboardList } from "lucide-react";
import { Button, Card, EmptyState, Input, Avatar, Modal } from "@pratham7711/ui";
import { formatDateAbs } from "@/lib/format";
import { toast } from "sonner";
import Link from "next/link";

type List = {
  id: string;
  name: string;
  description: string | null;
  _count: { items: number };
  createdAt: string;
};

const ACCENT_COLORS = ["var(--cc-primary)", "#7C3AED", "#059669", "#DC2626", "#F59E0B"];

export default function ListsClient({ lists }: { lists: List[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "" });
  const [creating, setCreating] = useState(false);

  const filtered = lists.filter(l => l.name.toLowerCase().includes(search.toLowerCase()));

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        toast.success("List created");
        setShowCreate(false);
        setCreateForm({ name: "", description: "" });
        router.refresh();
      } else {
        toast.error("Failed to create list");
      }
    } finally { setCreating(false); }
  };

  return (
    <div className="rsp-page">
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Lists</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Organize creators into curated lists</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowCreate(true)}>New List</Button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search lists..." iconLeft={<Search size={16} />} />
      </div>

      {filtered.length === 0 && lists.length === 0 ? (
        <EmptyState icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />} title="No lists yet" description="Create your first list to organize creators"
          action={<Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowCreate(true)}>New List</Button>}
        />
      ) : (
        <div className="cc-stagger rsp-grid-3">
          {filtered.map((list, i) => (
            <Link key={list.id} href={`/lists/${list.id}`} style={{ textDecoration: "none" }}>
              <Card variant="outlined" noPadding clickable>
                <div style={{ height: 4, background: ACCENT_COLORS[i % ACCENT_COLORS.length] }} />
                <div style={{ padding: 20 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", marginBottom: 8 }}>{list.name}</h3>
                  {list.description && <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 8 }}>{list.description}</p>}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--cc-text-muted)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Users size={13} /> {list._count.items} creators</span>
                    <span>{formatDateAbs(list.createdAt)}</span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}

          <div onClick={() => setShowCreate(true)} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", borderRadius: 12, cursor: "pointer", border: "2px dashed var(--cc-border)", minHeight: 180 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cc-bg)", marginBottom: 12 }}>
              <Plus size={20} style={{ color: "var(--cc-text-muted)" }} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text-muted)", margin: 0 }}>Create a new list</p>
          </div>
        </div>
      )}

      {showCreate && (
        <Modal open onClose={() => setShowCreate(false)} title="Create New List" size="md"
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" loading={creating} onClick={handleCreate}>Create List</Button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Input label="List Name *" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. TikTok Creators Q2" />
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Description</label>
              <textarea
                value={createForm.description}
                onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                rows={3} placeholder="Optional description..."
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", resize: "vertical", fontFamily: "inherit" }}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
