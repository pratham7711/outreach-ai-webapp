"use client";

import { Plus, Zap } from "lucide-react";
import { Button, Badge, StatCard } from "@pratham7711/ui";

const EmptyState = ({ icon, title, description, action }: { icon: string; title: string; description?: string; action?: React.ReactNode }) => (
  <div style={{ textAlign: "center", padding: "64px 24px" }}>
    <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
    <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>{title}</h3>
    {description && <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 20 }}>{description}</p>}
    {action}
  </div>
);

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

const STATUS_BADGE_VARIANT: Record<string, "warning" | "accent" | "success" | "danger" | "neutral"> = {
  AWAITING_DRAFT: "warning",
  DRAFT_SUBMITTED: "accent",
  AWAITING_APPROVAL: "warning",
  APPROVED: "success",
  POSTING: "accent",
  POSTED: "success",
  COMPLETE: "success",
  DECLINED: "danger",
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
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Activations</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Track creator deliverables and posts</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />}>Add Activation</Button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard value={String(stats.total)} label="Total" />
        <StatCard value={String(stats.active)} label="Active" />
        <StatCard value={String(activations.filter(a => a.status === "AWAITING_DRAFT" || a.status === "AWAITING_APPROVAL").length)} label="Pending" />
        <StatCard value={String(activations.filter(a => a.status === "COMPLETE").length)} label="Complete" />
      </div>

      {activations.length === 0 ? (
        <EmptyState
          icon="⚡"
          title="No activations yet"
          description="Activations will appear here once creators are assigned to campaigns."
          action={
            <Button variant="primary" iconLeft={<Plus size={16} />}>Add Activation</Button>
          }
        />
      ) : (
        /* Kanban Board */
        <div style={{ overflowX: "auto", paddingBottom: 16 }}>
          <div style={{ display: "flex", gap: 16, minWidth: "max-content" }}>
            {COLUMNS.map((col) => {
              const items = grouped.get(col) ?? [];
              return (
                <div key={col} style={{ width: 280, display: "flex", flexDirection: "column", background: "#F5F6FA", borderRadius: 12, border: "1px solid var(--cc-border)" }}>
                  {/* Column header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--cc-border)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLUMN_COLORS[col], flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)", flex: 1 }}>{COLUMN_LABELS[col]}</span>
                    <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 6px", borderRadius: 9999, background: "var(--cc-border)", color: "var(--cc-text-muted)" }}>
                      {items.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 500 }}>
                    {items.map((a) => (
                      <div
                        key={a.id}
                        style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 8, padding: 12, cursor: "pointer" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--cc-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>
                            {a.creator.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                          </div>
                          <p style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.creator.name}</p>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.campaign.title}</p>
                        <p style={{ fontSize: 10, color: "var(--cc-text-muted)" }}>{new Date(a.createdAt).toLocaleDateString()}</p>
                      </div>
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
