"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { FEATURES, type FeatureKey } from "@/lib/features";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  features: Record<string, boolean>;
  isCustom: boolean;
  clientCount: number;
  createdAt: string;
};

export default function PlansClient({ plans: initialPlans }: { plans: Plan[] }) {
  const router = useRouter();
  const [plans, setPlans] = useState(initialPlans);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Delete this plan? Clients will be unassigned.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/plans/${id}`, { method: "DELETE" });
      if (res.ok) {
        setPlans((prev) => prev.filter((p) => p.id !== id));
      }
    } finally {
      setDeleting(null);
    }
  }

  const featureKeys = Object.keys(FEATURES) as FeatureKey[];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Plans</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>
            Create and manage custom feature plans for clients
          </p>
        </div>
        <Link
          href="/plans/new"
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: "#2563EB" }}
        >
          <Plus size={16} />
          New Plan
        </Link>
      </div>

      {plans.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-24 rounded-2xl"
          style={{ border: "1px dashed var(--cc-border)", color: "var(--cc-text-muted)" }}
        >
          <div className="text-4xl mb-4">📋</div>
          <p style={{ fontSize: 16, fontWeight: 700 }}>No plans yet</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Create a plan to assign features to clients</p>
          <Link
            href="/plans/new"
            className="mt-6 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#2563EB" }}
          >
            <Plus size={15} />
            Create first plan
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="rounded-2xl flex flex-col"
              style={{
                background: "var(--cc-surface)",
                border: "1px solid var(--cc-border)",
              }}
            >
              {/* Header */}
              <div className="p-5" style={{ borderBottom: "1px solid var(--cc-border)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ fontWeight: 800, fontSize: 16, color: "var(--cc-text)" }}>{plan.name}</span>
                      {plan.isCustom && (
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: "rgba(37,99,235,0.12)", color: "#3b82f6" }}
                        >
                          Custom
                        </span>
                      )}
                    </div>
                    {plan.description && (
                      <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{plan.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link
                      href={`/plans/${plan.id}`}
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: "var(--cc-text-muted)" }}
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </Link>
                    <button
                      onClick={() => handleDelete(plan.id)}
                      disabled={deleting === plan.id}
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: "#ef4444" }}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 mt-3" style={{ color: "var(--cc-text-muted)", fontSize: 12 }}>
                  <Users size={12} />
                  <span>{plan.clientCount} client{plan.clientCount !== 1 ? "s" : ""}</span>
                </div>
              </div>

              {/* Feature badges */}
              <div className="p-5 flex flex-wrap gap-2">
                {featureKeys.map((key) => {
                  const on = plan.features[key] === true;
                  return (
                    <span
                      key={key}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium"
                      style={{
                        background: on ? "rgba(34,197,94,0.12)" : "var(--cc-surface-2)",
                        color: on ? "#22c55e" : "var(--cc-text-muted)",
                        border: `1px solid ${on ? "rgba(34,197,94,0.2)" : "var(--cc-border)"}`,
                      }}
                    >
                      {on ? "✓ " : "✗ "}{FEATURES[key].label}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
