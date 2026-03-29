"use client";
import { Button, Badge, Card, StatCard, Avatar } from "@pratham7711/ui";

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
    <div className="cc-page-content">
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Requests</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>View and manage payout requests</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard value="4" label="Total Requests" />
        <StatCard value="2" label="Pending" />
        <StatCard value="$5,950" label="Total Amount" />
      </div>

      <Card variant="outlined" noPadding>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>All Requests</span>
        </div>
        {REQUESTS.map((r, i) => (
          <div
            key={r.id}
            className="cc-table-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "14px 20px",
              borderBottom: i < REQUESTS.length - 1 ? "1px solid var(--cc-border)" : "none",
            }}
          >
            <Avatar name={r.creator} size="sm" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{r.creator}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{r.type} · {r.note}</div>
            </div>
            <Badge variant={STATUS_BADGE[r.status]} size="sm">{r.status}</Badge>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>${r.amount.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{r.date}</div>
            </div>
            {r.status === "pending" && (
              <div style={{ display: "flex", gap: 8 }}>
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
