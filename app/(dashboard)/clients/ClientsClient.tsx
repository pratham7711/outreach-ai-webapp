"use client";
import { Button, Badge, Card, StatCard } from "@pratham7711/ui";
import { Plus } from "lucide-react";

type Client = {
  id: string;
  name: string;
  logoUrl: string | null;
  contactInfo: any;
  _count: { campaigns: number };
};

export default function ClientsClient({ clients, stats }: {
  clients: Client[];
  stats: { total: number; totalCampaigns: number };
}) {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Clients</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Manage your client relationships</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={16} />}>Add Client</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard value={String(stats.total)} label="Total Clients" />
        <StatCard value={String(stats.totalCampaigns)} label="Total Campaigns" />
      </div>

      <Card variant="glass" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>All Clients</span>
        </div>
        {clients.map((c, i) => (
          <div key={c.id} className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: i < clients.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold" style={{ background: "var(--cc-surface-2)", color: "var(--cc-text)" }}>
              {c.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{c.name}</div>
            </div>
            <div className="text-center">
              <div style={{ fontWeight: 800, fontSize: 14, color: "var(--cc-text)" }}>{c._count.campaigns}</div>
              <div style={{ fontSize: 10, color: "var(--cc-text-muted)" }}>Campaigns</div>
            </div>
          </div>
        ))}
        {clients.length === 0 && (
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: 40 }}>No clients yet</p>
        )}
      </Card>
    </div>
  );
}
