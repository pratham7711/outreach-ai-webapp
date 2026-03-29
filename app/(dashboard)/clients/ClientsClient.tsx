"use client";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { Button, Card, StatCard, Input, Avatar, EmptyState } from "@pratham7711/ui";
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
    <div className="cc-page-content">
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Clients
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Manage your client relationships and billing
          </p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)}>
          Add Client
        </Button>
      </div>

      {/* Stats */}
      <div className="cc-stagger grid grid-cols-1 sm:grid-cols-2" style={{ gap: 20, marginBottom: 32, maxWidth: 480 }}>
        <StatCard value={String(stats.total)} label="Total Clients" />
        <StatCard value={String(stats.totalCampaigns)} label="Total Campaigns" />
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
        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-hover-bg)" }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>All Clients</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px" }}>
            <EmptyState
              icon="🏢"
              title="No clients yet"
              description="Add your first client to start managing campaigns"
              action={
                <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
                  Add Client
                </Button>
              }
            />
          </div>
        ) : (
          <div className="cc-stagger">
            {filtered.map((c, i) => (
              <Link key={c.id} href={`/clients/${c.id}`} style={{ textDecoration: "none" }}>
                <div
                  className="cc-table-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "14px 24px",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <Avatar name={c.name} size="md" src={c.logoUrl ?? undefined} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: "var(--cc-text)" }}>{c.name}</div>
                    <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                      {c._count.campaigns} campaign{c._count.campaigns !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">View</Button>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {showModal && <AddClientModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
