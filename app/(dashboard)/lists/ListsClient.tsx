"use client";

import { useState } from "react";
import { Plus, Users, Share2, Search } from "lucide-react";
import { Button, Card } from "@pratham7711/ui";

const EmptyState = ({ icon, title, description, action }: { icon: string; title: string; description?: string; action?: React.ReactNode }) => (
  <div style={{ textAlign: "center", padding: "64px 24px" }}>
    <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
    <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>{title}</h3>
    {description && <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 20 }}>{description}</p>}
    {action}
  </div>
);
const SearchInput = ({ value, onChange, placeholder }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) => (
  <div style={{ position: "relative" }}>
    <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--cc-text-muted)", pointerEvents: "none" }} />
    <input value={value} onChange={onChange} placeholder={placeholder} style={{ width: "100%", padding: "9px 12px 9px 36px", border: "1px solid var(--cc-border)", borderRadius: 8, fontSize: 14, background: "var(--cc-card)", color: "var(--cc-text)", outline: "none" }} />
  </div>
);

type List = {
  id: string;
  name: string;
  description: string | null;
  _count: { items: number };
  createdAt: string;
};

const ACCENT_COLORS = [
  "#5B5BD6",
  "#7C3AED",
  "#059669",
  "#DC2626",
];

export default function ListsClient({ lists }: { lists: List[] }) {
  const [search, setSearch] = useState("");

  const filtered = lists.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Lists</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Organize creators into curated lists</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />}>New List</Button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 24 }}>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lists..." />
      </div>

      {filtered.length === 0 && lists.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No lists yet"
          description="Create your first list to organize creators"
          action={
            <Button variant="primary" iconLeft={<Plus size={16} />}>New List</Button>
          }
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {filtered.map((list, i) => (
            <div key={list.id} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ height: 4, background: ACCENT_COLORS[i % ACCENT_COLORS.length] }} />
              <div style={{ padding: 20 }}>
                <h3 style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", marginBottom: 8 }}>{list.name}</h3>
                {list.description && (
                  <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 8 }}>{list.description}</p>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--cc-text-muted)" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Users size={13} /> {list._count.items} creators</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--cc-border)" }}>
                  <div style={{ display: "flex", marginLeft: -4 }}>
                    {Array.from({ length: Math.min(list._count.items, 4) }).map((_, j) => (
                      <div key={j} style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--cc-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 9, fontWeight: 700, border: "2px solid var(--cc-card)", marginLeft: j > 0 ? -8 : 0 }}>
                        {String.fromCharCode(65 + j)}
                      </div>
                    ))}
                    {list._count.items > 4 && (
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#F3F4F8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "var(--cc-text-muted)", border: "2px solid var(--cc-card)", marginLeft: -8 }}>
                        +{list._count.items - 4}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm">
                    <Share2 size={14} />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {/* Create new list card */}
          <div
            style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", borderRadius: 12, cursor: "pointer", border: "2px dashed var(--cc-border)", minHeight: 200 }}
            onClick={() => {}}
          >
            <div style={{ width: 48, height: 48, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "#F3F4F8", marginBottom: 12 }}>
              <Plus size={20} style={{ color: "var(--cc-text-muted)" }} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text-muted)" }}>Create a new list</p>
          </div>
        </div>
      )}
    </div>
  );
}
