"use client";
import { Button, Badge, Card, StatCard } from "@pratham7711/ui";

const REQUESTS = [
  { id: "r1", creator: "Aria Rose", type: "Payout", amount: 3200, status: "pending", date: "2026-07-10", note: "Campaign completion bonus" },
  { id: "r2", creator: "Jake Mercer", type: "Rate Increase", amount: 500, status: "approved", date: "2026-07-08", note: "Performance-based rate bump" },
  { id: "r3", creator: "Sofia Vega", type: "Payout", amount: 1800, status: "pending", date: "2026-07-12", note: "Content delivery milestone" },
  { id: "r4", creator: "Marcus Webb", type: "Expense", amount: 450, status: "rejected", date: "2026-07-05", note: "Equipment rental reimbursement" },
];

const STATUS_BADGE: Record<string, "warning"|"success"|"danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

export default function RequestsPage() {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Requests</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>View and manage payout requests</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard value="4" label="Total Requests" />
        <StatCard value="2" label="Pending" />
        <StatCard value="$5,950" label="Total Amount" />
      </div>

      <Card variant="glass" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>All Requests</span>
        </div>
        {REQUESTS.map((r, i) => (
          <div key={r.id} className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: i < REQUESTS.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
              {r.creator.split(" ").map(n => n[0]).join("")}
            </div>
            <div className="flex-1">
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{r.creator}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{r.type} · {r.note}</div>
            </div>
            <Badge variant={STATUS_BADGE[r.status]} size="sm">{r.status}</Badge>
            <div className="text-right">
              <div style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>${r.amount.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{r.date}</div>
            </div>
            {r.status === "pending" && (
              <div className="flex gap-2">
                <Button variant="primary" size="sm">Approve</Button>
                <Button variant="ghost" size="sm">Deny</Button>
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
