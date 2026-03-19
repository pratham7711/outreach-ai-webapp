"use client";

import { motion } from "framer-motion";
import { Plus, Zap } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

type Activation = {
  id: string;
  status: string;
  createdAt: string;
  creator: { id: string; name: string; handle: string; platform: string; avatarUrl: string | null };
  campaign: { id: string; title: string };
};

const COLUMNS = [
  "AWAITING_DRAFT",
  "DRAFT_SUBMITTED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "POSTING",
  "POSTED",
  "COMPLETE",
  "DECLINED",
] as const;

const COLUMN_LABELS: Record<string, string> = {
  AWAITING_DRAFT: "Awaiting Draft",
  DRAFT_SUBMITTED: "Draft Submitted",
  AWAITING_APPROVAL: "Awaiting Approval",
  APPROVED: "Approved",
  POSTING: "Posting",
  POSTED: "Posted",
  COMPLETE: "Complete",
  DECLINED: "Declined",
};

const COLUMN_COLORS: Record<string, string> = {
  AWAITING_DRAFT: "bg-amber-500",
  DRAFT_SUBMITTED: "bg-blue-500",
  AWAITING_APPROVAL: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  POSTING: "bg-[var(--color-primary)]",
  POSTED: "bg-emerald-500",
  COMPLETE: "bg-emerald-600",
  DECLINED: "bg-red-500",
};

export default function ActivationsClient({ activations, stats }: {
  activations: Activation[];
  stats: { total: number; active: number };
}) {
  // Group activations by status
  const grouped = new Map<string, Activation[]>();
  for (const col of COLUMNS) grouped.set(col, []);
  for (const a of activations) {
    const col = COLUMNS.includes(a.status as typeof COLUMNS[number]) ? a.status : "AWAITING_DRAFT";
    grouped.get(col)!.push(a);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Activations"
        description={`${stats.total} total activations, ${stats.active} active`}
        actions={
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[var(--color-primary)] to-purple-500 text-white text-sm font-medium hover:opacity-90 transition-opacity shadow-lg shadow-[var(--color-primary)]/25">
            <Plus className="h-4 w-4" />
            Add Activation
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total", value: stats.total },
          { label: "Active", value: stats.active },
          { label: "Pending", value: activations.filter(a => a.status === "AWAITING_DRAFT" || a.status === "AWAITING_APPROVAL").length },
          { label: "Complete", value: activations.filter(a => a.status === "COMPLETE").length },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
            <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl p-4">
              <p className="text-xs text-[#8888AA] mb-1">{s.label}</p>
              <p className="text-xl font-bold text-[#F0F0FF]">{s.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {activations.length === 0 ? (
        <EmptyState
          icon={<Zap className="h-6 w-6" />}
          title="No activations yet"
          description="Activations will appear here once creators are assigned to campaigns."
        />
      ) : (
        /* Kanban Board */
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {COLUMNS.map((col) => {
              const items = grouped.get(col) ?? [];
              return (
                <div key={col} className="w-72 flex flex-col bg-[#0D0D14] rounded-xl border border-[#2A2A3A]">
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1E1E2C]">
                    <span className={`w-2 h-2 rounded-full ${COLUMN_COLORS[col]}`} />
                    <span className="text-xs font-semibold text-[#F0F0FF]">{COLUMN_LABELS[col]}</span>
                    <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/5 text-[#8888AA]">
                      {items.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[500px]">
                    {items.map((a, i) => (
                      <motion.div
                        key={a.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <div className="bg-[#111118] border border-[#2A2A3A] rounded-lg p-3 cursor-pointer hover:border-[var(--color-primary)]/30 transition-colors">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-purple-600 flex items-center justify-center text-white text-[8px] font-bold shrink-0">
                              {a.creator.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                            </div>
                            <p className="text-sm font-medium text-[#F0F0FF] truncate">{a.creator.name}</p>
                          </div>
                          <p className="text-xs text-[#8888AA] mb-2 truncate">{a.campaign.title}</p>
                          <p className="text-[10px] text-[#555577]">{new Date(a.createdAt).toLocaleDateString()}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {/* Add button */}
                  <button className="m-2 py-2 rounded-lg border border-dashed border-[#2A2A3A] text-xs text-[#555577] hover:text-[#8888AA] hover:border-[#8888AA] transition-colors">
                    + Add
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
