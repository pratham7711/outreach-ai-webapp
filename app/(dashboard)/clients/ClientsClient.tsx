"use client";
import { useState } from "react";
import { Plus, Search, Building2 } from "lucide-react";
import Link from "next/link";
import { Card, Input, Avatar, EmptyState } from "@pratham7711/ui";
import { MetricTile, Button } from "@/components/ds";
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
    <div className="rsp-page">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Clients
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Manage your client relationships and billing
          </p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)}>
          New Client
        </Button>
      </div>

      {/* Stats */}
      <div className="cc-stagger grid grid-cols-1 sm:grid-cols-2" style={{ gap: 20, marginBottom: 32, maxWidth: 480 }}>
        <MetricTile metric="clientsTotal" value={String(stats.total)} />
        {/* Org-wide, not "campaigns belonging to these clients": the count includes
            campaigns with no client assigned, so it does not add up from the rows. */}
        <MetricTile
          metric="campaigns"
          label="Campaigns org-wide"
          value={String(stats.totalCampaigns)}
          footer="Across every client, including campaigns with none assigned"
        />
      </div>

      {/* Search */}
      <div style={{ marginBottom: 24 }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Clients"
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
            {/* A filtered miss is not an empty account. Telling somebody with 40
                clients to "add your first client" because their search matched
                none of them offers the one action that will not help. */}
            {search.trim() ? (
              <EmptyState
                icon={<Search size={32} color="var(--cc-text-subtle)" />}
                title="No clients match that search"
                description={`None of your ${clients.length} client${clients.length === 1 ? "" : "s"} match “${search.trim()}”.`}
                action={
                  <Button variant="secondary" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Building2 size={32} color="var(--cc-text-subtle)" />}
                title="No clients yet"
                description="Add your first client to start managing campaigns"
                action={
                  <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
                    New Client
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <div className="cc-stagger">
            {filtered.map((c, i) => (
              <Link prefetch={false} key={c.id} href={`/clients/${c.id}`} style={{ textDecoration: "none" }}>
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
