"use client";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { Button, Card, StatCard } from "@pratham7711/ui";

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

import AddClientModal from "@/components/modals/AddClientModal";

type Client = {
  id: string;
  name: string;
  logoUrl: string | null;
  contactInfo: unknown;
  _count: { campaigns: number };
};

export default function ClientsClient({ clients, stats }: {
  clients: Client[];
  stats: { total: number; totalCampaigns: number };
}) {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Clients</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Manage your client relationships and billing</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
          Add Client
        </Button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 32, maxWidth: 480 }}>
        <StatCard value={String(stats.total)} label="Total Clients" />
        <StatCard value={String(stats.totalCampaigns)} label="Total Campaigns" />
      </div>

      {/* Search */}
      <div style={{ marginBottom: 24 }}>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients..." />
      </div>

      {/* Clients table */}
      <Card variant="solid" noPadding>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>All Clients</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "40px 0" }}>
            <EmptyState
              icon="🏢"
              title="No clients yet"
              description="Add your first client to start managing campaigns"
              action={
                <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowModal(true)}>
                  Add Client
                </Button>
              }
            />
          </div>
        ) : (
          filtered.map((c, i) => (
            <Link key={c.id} href={`/clients/${c.id}`} style={{ textDecoration: "none" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 20px",
                  borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F9FAFB"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: "#EEF2FF", color: "#5B5BD6", flexShrink: 0 }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{c._count.campaigns} campaign{c._count.campaigns !== 1 ? "s" : ""}</div>
                </div>
                <Button variant="ghost" size="sm">View</Button>
              </div>
            </Link>
          ))
        )}
      </Card>

      {showModal && <AddClientModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
