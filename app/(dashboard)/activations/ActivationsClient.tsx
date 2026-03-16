"use client";
import { Badge, Card, StatCard } from "@pratham7711/ui";

type Activation = {
  id: string;
  status: string;
  createdAt: string;
  creator: { id: string; name: string; handle: string; platform: string; avatarUrl: string | null };
  campaign: { id: string; title: string };
};

const STATUS_BADGE: Record<string, "success" | "warning" | "neutral"> = {
  ACTIVE: "success",
  PENDING: "warning",
  DRAFT: "neutral",
  COMPLETED: "success",
};

export default function ActivationsClient({ activations, stats }: {
  activations: Activation[];
  stats: { total: number; active: number };
}) {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Activations</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Track creator activations across campaigns</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard value={String(stats.total)} label="Total Activations" />
        <StatCard value={String(stats.active)} label="Active" />
      </div>

      <Card variant="glass" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>All Activations</span>
        </div>
        {activations.map((a, i) => (
          <div key={a.id} className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: i < activations.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
              {a.creator.name.split(" ").map(n => n[0]).join("")}
            </div>
            <div className="flex-1">
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{a.creator.name}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{a.campaign.title}</div>
            </div>
            <Badge variant={STATUS_BADGE[a.status] ?? "neutral"} size="sm">{a.status}</Badge>
            <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{new Date(a.createdAt).toLocaleDateString()}</div>
          </div>
        ))}
        {activations.length === 0 && (
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: 40 }}>No activations yet</p>
        )}
      </Card>
    </div>
  );
}
