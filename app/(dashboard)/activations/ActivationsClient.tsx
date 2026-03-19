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
  AWAITING_DRAFT: "#f59e0b",
  DRAFT_SUBMITTED: "#3b82f6",
  AWAITING_APPROVAL: "#f59e0b",
  APPROVED: "#22c55e",
  POSTING: "var(--cc-primary)",
  POSTED: "#22c55e",
  COMPLETE: "#16a34a",
  DECLINED: "#ef4444",
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
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4 }}>{s.label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{s.value}</p>
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
                <div key={col} className="w-72 flex flex-col" style={{ background: "#F5F6FA", borderRadius: 12, border: "1px solid var(--cc-border)" }}>
                  {/* Column header */}
                  <div className="flex items-center gap-2" style={{ padding: "12px 16px", borderBottom: "1px solid var(--cc-border)" }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: COLUMN_COLORS[col] }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)" }}>{COLUMN_LABELS[col]}</span>
                    <span className="ml-auto" style={{ fontSize: 10, fontWeight: 500, padding: "2px 6px", borderRadius: 9999, background: "var(--cc-border)", color: "var(--cc-text-muted)" }}>
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
                        <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 8, padding: 12, cursor: "pointer" }}>
                          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0" style={{ background: "var(--cc-primary)" }}>
                              {a.creator.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                            </div>
                            <p className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{a.creator.name}</p>
                          </div>
                          <p className="truncate" style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 8 }}>{a.campaign.title}</p>
                          <p style={{ fontSize: 10, color: "var(--cc-text-muted)" }}>{new Date(a.createdAt).toLocaleDateString()}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {/* Add button */}
                  <button style={{ margin: 8, padding: "8px 0", borderRadius: 8, border: "1px dashed var(--cc-border)", fontSize: 12, color: "var(--cc-text-muted)", background: "transparent", cursor: "pointer" }}>
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
