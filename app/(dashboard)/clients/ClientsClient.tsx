"use client";
import { Plus } from "lucide-react";
import Link from "next/link";

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
  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Clients</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Manage your client relationships</p>
        </div>
        <button style={{ background: "var(--cc-primary)", color: "white", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={15} /> Add Client
        </button>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        {[
          { label: "Total Clients", value: String(stats.total) },
          { label: "Total Campaigns", value: String(stats.totalCampaigns) },
        ].map(s => (
          <div key={s.label} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Clients table */}
      <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>All Clients</span>
        </div>
        {clients.map((c, i) => (
          <Link key={c.id} href={`/clients/${c.id}`} style={{ textDecoration: "none" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "14px 20px",
                borderBottom: i < clients.length - 1 ? "1px solid var(--cc-border)" : "none",
                cursor: "pointer",
              }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, background: "#F3F4F8", color: "var(--cc-text)", flexShrink: 0 }}>
                {c.name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{c.name}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{c._count.campaigns}</div>
                <div style={{ fontSize: 10, color: "var(--cc-text-muted)" }}>Campaigns</div>
              </div>
            </div>
          </Link>
        ))}
        {clients.length === 0 && (
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: 40 }}>No clients yet</p>
        )}
      </div>
    </div>
  );
}
