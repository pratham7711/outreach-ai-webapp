"use client";
import { Button, Badge, StatCard, Card } from "@pratham7711/ui";
import { Plus } from "lucide-react";

type Payout = {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  creator: { id: string; name: string; handle: string; platform: string };
  campaign: { id: string; title: string } | null;
};

const STATUS_BADGE: Record<string, "success" | "warning" | "neutral"> = {
  COMPLETED: "success",
  PENDING: "warning",
  PROCESSING: "neutral",
};

export default function PayoutsClient({ payouts, stats }: {
  payouts: Payout[];
  stats: { total: number; sent: number; pending: number };
}) {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Payouts</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Track and manage creator payments</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={16} />}>New Payout</Button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard value={`$${stats.total.toLocaleString()}`} label="Total Payouts" />
        <StatCard value={`$${stats.sent.toLocaleString()}`} label="Sent" />
        <StatCard value={`$${stats.pending.toLocaleString()}`} label="Pending" />
      </div>

      <Card variant="glass" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>Recent Payouts</span>
        </div>
        <div>
          {payouts.map((p, i) => (
            <div
              key={p.id}
              className="flex items-center gap-4 px-5 py-4 transition-colors"
              style={{
                borderBottom: i < payouts.length - 1 ? "1px solid var(--cc-border)" : "none",
                cursor: "pointer",
              }}
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                {p.creator.name.split(" ").map((n) => n[0]).join("")}
              </div>
              <div className="flex-1">
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{p.creator.name}</div>
                <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{p.campaign?.title ?? "—"}</div>
              </div>
              <Badge variant={STATUS_BADGE[p.status] ?? "neutral"}>{p.status}</Badge>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>${p.amount.toLocaleString()}</div>
                <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{new Date(p.createdAt).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
          {payouts.length === 0 && (
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: 40 }}>No payouts yet</p>
          )}
        </div>
      </Card>
    </div>
  );
}
