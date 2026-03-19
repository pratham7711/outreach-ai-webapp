"use client";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { Button, Card, StatCard, EmptyState, Input } from "@pratham7711/ui";
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
        <StatCard value={String(stats.total)} label="Total Clients" trend="up" trendLabel="+1 this month" />
        <StatCard value={String(stats.totalCampaigns)} label="Total Campaigns" trend="up" />
      </div>

      {/* Search */}
      <div style={{ marginBottom: 24 }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients..."
          iconLeft={<Search size={16} />}
        />
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
