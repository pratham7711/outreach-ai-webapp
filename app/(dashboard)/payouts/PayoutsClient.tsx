"use client";

import { motion } from "framer-motion";
import { Plus, DollarSign, CreditCard, Wallet } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

type Payout = {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  creator: { id: string; name: string; handle: string; platform: string };
  campaign: { id: string; title: string } | null;
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function PayoutsClient({ payouts, stats }: {
  payouts: Payout[];
  stats: { total: number; sent: number; pending: number };
}) {
  const statCards = [
    { title: "Total Paid", value: formatCurrency(stats.sent), icon: <DollarSign className="h-4 w-4" style={{ color: "#22c55e" }} /> },
    { title: "Pending Amount", value: formatCurrency(stats.pending), icon: <Wallet className="h-4 w-4" style={{ color: "#f59e0b" }} /> },
    { title: "Total Processed", value: formatCurrency(stats.total), icon: <CreditCard className="h-4 w-4" style={{ color: "var(--cc-primary)" }} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="Track and manage creator payments"
        actions={
          <button
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 16px", borderRadius: 8,
              background: "var(--cc-primary)", color: "white",
              fontSize: 14, fontWeight: 500,
              border: "none", cursor: "pointer",
            }}
          >
            <Plus className="h-4 w-4" />
            Process Payout
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {statCards.map((s, i) => (
          <motion.div key={s.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>{s.title}</p>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#F3F4F6" }}>
                  {s.icon}
                </div>
              </div>
              <p style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>{s.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {payouts.length === 0 ? (
        <EmptyState
          icon={<DollarSign className="h-6 w-6" />}
          title="No payouts yet"
          description="Payouts will appear here once you start paying creators."
          action={
            <button style={{ padding: "8px 16px", borderRadius: 8, background: "var(--cc-primary)", color: "white", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer" }}>
              Process Payout
            </button>
          }
        />
      ) : (
        <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Creator</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Campaign</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Amount</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Status</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p, i) => (
                <motion.tr
                  key={p.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="transition-colors"
                  style={{ borderTop: "1px solid var(--cc-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "14px 20px" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: "var(--cc-primary)" }}>
                        {p.creator.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{p.creator.name}</p>
                        <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{p.creator.handle}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "14px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{p.campaign?.title ?? "—"}</td>
                  <td style={{ padding: "14px 20px", fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{formatCurrency(p.amount)}</td>
                  <td style={{ padding: "14px 20px" }}><StatusBadge status={p.status} /></td>
                  <td style={{ padding: "14px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
