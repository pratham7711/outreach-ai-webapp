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
    { title: "Total Paid", value: formatCurrency(stats.sent), icon: <DollarSign className="h-4 w-4 text-emerald-400" />, color: "emerald" },
    { title: "Pending Amount", value: formatCurrency(stats.pending), icon: <Wallet className="h-4 w-4 text-amber-400" />, color: "amber" },
    { title: "Total Processed", value: formatCurrency(stats.total), icon: <CreditCard className="h-4 w-4 text-[var(--color-primary)]" />, color: "primary" },
  ];

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="Track and manage creator payments"
        actions={
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[var(--color-primary)] to-purple-500 text-white text-sm font-medium hover:opacity-90 transition-opacity shadow-lg shadow-[var(--color-primary)]/25">
            <Plus className="h-4 w-4" />
            Process Payout
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {statCards.map((s, i) => (
          <motion.div key={s.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
            <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl p-5 hover:border-[var(--color-primary)]/30 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-[#8888AA]">{s.title}</p>
                <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
                  {s.icon}
                </div>
              </div>
              <p className="text-2xl font-bold text-[#F0F0FF]">{s.value}</p>
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
            <button className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] transition-colors">
              Process Payout
            </button>
          }
        />
      ) : (
        <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0D0D14]">
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Creator</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Campaign</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Amount</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Status</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p, i) => (
                <motion.tr
                  key={p.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-t border-[#1E1E2C] hover:bg-[#1A1A24] transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-purple-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                        {p.creator.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#F0F0FF]">{p.creator.name}</p>
                        <p className="text-xs text-[#555577]">@{p.creator.handle}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{p.campaign?.title ?? "—"}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-[#F0F0FF]">{formatCurrency(p.amount)}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={p.status} /></td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{new Date(p.createdAt).toLocaleDateString()}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
