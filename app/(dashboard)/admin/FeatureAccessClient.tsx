"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ExternalLink } from "lucide-react";
import Link from "next/link";
import ClientFeatureModal from "@/components/modals/ClientFeatureModal";
import { FEATURES, type FeatureKey } from "@/lib/features";

const featureKeys = Object.keys(FEATURES) as FeatureKey[];

interface ClientData {
  id: string;
  name: string;
  logoUrl: string | null;
  planId: string | null;
  planName: string | null;
  planFeatures: Record<string, boolean> | null;
  featureOverrides: Record<string, boolean> | null;
  campaignCount: number;
}

interface PlanData {
  id: string;
  name: string;
  features: Record<string, boolean>;
  clientCount: number;
}

interface FeatureAccessClientProps {
  clients: ClientData[];
  plans: PlanData[];
}

function getEnabledCount(client: ClientData): number {
  let count = 0;
  for (const key of featureKeys) {
    const override = client.featureOverrides?.[key];
    if (override === true) { count++; continue; }
    if (override === false) continue;
    if (client.planFeatures?.[key]) count++;
  }
  return count;
}

function getOverrideCount(client: ClientData): number {
  if (!client.featureOverrides) return 0;
  return Object.keys(client.featureOverrides).length;
}

export default function FeatureAccessClient({ clients: initialClients, plans }: FeatureAccessClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "by-plan" | "overrides">("all");
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPlanId, setBulkPlanId] = useState<string>("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const filtered = initialClients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const clientsWithOverrides = filtered.filter((c) => getOverrideCount(c) > 0);

  const openModal = (client: ClientData) => {
    setSelectedClient(client);
    setShowModal(true);
  };

  const handleSaveClient = () => {
    setShowModal(false);
    setSelectedClient(null);
    router.refresh();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.id)));
    }
  };

  async function handleBulkAssign() {
    if (selected.size === 0) return;
    setBulkSaving(true);
    try {
      const res = await fetch("/api/clients/bulk-plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientIds: Array.from(selected),
          planId: bulkPlanId || null,
        }),
      });
      if (res.ok) {
        setSelected(new Set());
        setBulkPlanId("");
        router.refresh();
      }
    } finally {
      setBulkSaving(false);
    }
  }

  async function handleBulkClearOverrides() {
    if (selected.size === 0) return;
    if (!confirm(`Clear all feature overrides for ${selected.size} client(s)?`)) return;
    setBulkSaving(true);
    try {
      const res = await fetch("/api/clients/bulk-plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientIds: Array.from(selected),
          planId: null,
          clearOverrides: true,
        }),
      });
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      }
    } finally {
      setBulkSaving(false);
    }
  }

  const tabs = [
    { key: "all" as const, label: "All Clients" },
    { key: "by-plan" as const, label: "By Plan" },
    { key: "overrides" as const, label: "Overrides Only" },
  ];

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
            Feature Access
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Manage plan assignments and feature overrides per client
          </p>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 8,
          background: "rgba(91,91,214,0.1)", color: "#5B5BD6",
        }}>
          {initialClients.length} clients
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSelected(new Set()); }}
            style={{
              padding: "8px 16px",
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              border: `1px solid ${tab === t.key ? "var(--cc-primary)" : "var(--cc-border)"}`,
              background: tab === t.key ? "var(--cc-primary)" : "var(--cc-card)",
              color: tab === t.key ? "white" : "var(--cc-text)",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 24, position: "relative" }}>
        <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--cc-text-muted)", pointerEvents: "none" }} />
        <input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 12px 10px 36px",
            border: "1px solid var(--cc-border)",
            borderRadius: 8,
            fontSize: 14,
            background: "var(--cc-card)",
            color: "var(--cc-text)",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Tab: All Clients */}
      {tab === "all" && (
        <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>No clients found</p>
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginTop: 4 }}>Try adjusting your search</p>
            </div>
          ) : (
            <>
              {/* Table header */}
              <div style={{
                padding: "12px 20px",
                borderBottom: "1px solid var(--cc-border)",
                display: "grid",
                gridTemplateColumns: "32px 1fr 140px 130px 110px 120px",
                gap: 12,
                alignItems: "center",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                color: "var(--cc-text-muted)",
              }}>
                <div>
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    style={{ cursor: "pointer", accentColor: "var(--cc-primary)" }}
                  />
                </div>
                <div>Client</div>
                <div>Plan</div>
                <div>Features</div>
                <div>Overrides</div>
                <div>Actions</div>
              </div>

              {/* Table rows */}
              {filtered.map((client) => {
                const enabledCount = getEnabledCount(client);
                const overrideCount = getOverrideCount(client);
                const isSelected = selected.has(client.id);
                return (
                  <div
                    key={client.id}
                    style={{
                      padding: "12px 20px",
                      borderBottom: "1px solid var(--cc-border)",
                      display: "grid",
                      gridTemplateColumns: "32px 1fr 140px 130px 110px 120px",
                      gap: 12,
                      alignItems: "center",
                      background: isSelected ? "rgba(91,91,214,0.04)" : "transparent",
                      transition: "background 0.1s",
                    }}
                  >
                    <div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(client.id)}
                        style={{ cursor: "pointer", accentColor: "var(--cc-primary)" }}
                      />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        background: "#EEF2FF", color: "#5B5BD6",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, flexShrink: 0,
                      }}>
                        {client.name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{client.name}</span>
                    </div>

                    <div>
                      <span style={{
                        fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                        background: client.planName ? "rgba(91,91,214,0.1)" : "#F3F4F6",
                        color: client.planName ? "#5B5BD6" : "var(--cc-text-muted)",
                      }}>
                        {client.planName || "No Plan"}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{enabledCount}/{featureKeys.length}</span>
                      <div style={{ flex: 1, maxWidth: 60, height: 4, borderRadius: 2, background: "#F3F4F6", overflow: "hidden" }}>
                        <div style={{ width: `${(enabledCount / featureKeys.length) * 100}%`, height: "100%", borderRadius: 2, background: enabledCount > 7 ? "#22c55e" : enabledCount > 4 ? "#eab308" : "#ef4444", transition: "width 0.3s" }} />
                      </div>
                    </div>

                    <div>
                      {overrideCount > 0 && (
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                          background: "rgba(234,179,8,0.1)", color: "#d97706",
                        }}>
                          {overrideCount} override{overrideCount > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => openModal(client)}
                        style={{
                          padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                          background: "transparent", border: "1px solid var(--cc-border)",
                          color: "var(--cc-text)", cursor: "pointer",
                        }}
                      >
                        Manage
                      </button>
                      <Link
                        href={`/clients/${client.id}`}
                        style={{
                          padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                          background: "transparent", border: "1px solid var(--cc-border)",
                          color: "var(--cc-text-muted)", display: "flex", alignItems: "center",
                          textDecoration: "none",
                        }}
                      >
                        <ExternalLink size={12} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Tab: By Plan */}
      {tab === "by-plan" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
          {(() => {
            const noPlanClients = filtered.filter((c) => !c.planId);
            if (noPlanClients.length === 0) return null;
            return (
              <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>No Plan</h3>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: "#F3F4F6", color: "var(--cc-text-muted)" }}>
                    {noPlanClients.length} client{noPlanClients.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {noPlanClients.map((c) => (
                    <div key={c.id} title={c.name} onClick={() => openModal(c)} style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "#EEF2FF", color: "#5B5BD6",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, cursor: "pointer",
                    }}>
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {plans.map((plan) => {
            const clientsOnPlan = filtered.filter((c) => c.planId === plan.id);
            if (clientsOnPlan.length === 0) return null;
            return (
              <div key={plan.id} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>{plan.name}</h3>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: "rgba(91,91,214,0.1)", color: "#5B5BD6" }}>
                    {clientsOnPlan.length} client{clientsOnPlan.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {clientsOnPlan.map((c) => (
                    <div key={c.id} title={c.name} onClick={() => openModal(c)} style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "#EEF2FF", color: "#5B5BD6",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, cursor: "pointer",
                    }}>
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                  ))}
                </div>
                <Link href="/plans" style={{ display: "inline-block", marginTop: 12, fontSize: 12, color: "var(--cc-primary)", textDecoration: "none" }}>
                  View all →
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab: Overrides Only */}
      {tab === "overrides" && (
        <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
          {clientsWithOverrides.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>No overrides</p>
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginTop: 4 }}>No clients have custom feature overrides</p>
            </div>
          ) : (
            <>
              <div style={{
                padding: "12px 20px", borderBottom: "1px solid var(--cc-border)",
                display: "grid", gridTemplateColumns: "1fr 140px 1fr 100px", gap: 12,
                fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--cc-text-muted)",
              }}>
                <div>Client</div>
                <div>Plan</div>
                <div>Overridden Features</div>
                <div>Actions</div>
              </div>
              {clientsWithOverrides.map((client) => {
                const overriddenKeys = featureKeys.filter((k) => client.featureOverrides?.[k] !== undefined);
                return (
                  <div key={client.id} style={{
                    padding: "12px 20px", borderBottom: "1px solid var(--cc-border)",
                    display: "grid", gridTemplateColumns: "1fr 140px 1fr 100px", gap: 12, alignItems: "center",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        background: "#EEF2FF", color: "#5B5BD6",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, flexShrink: 0,
                      }}>
                        {client.name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{client.name}</span>
                    </div>
                    <div>
                      <span style={{
                        fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                        background: client.planName ? "rgba(91,91,214,0.1)" : "#F3F4F6",
                        color: client.planName ? "#5B5BD6" : "var(--cc-text-muted)",
                      }}>
                        {client.planName || "No Plan"}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {overriddenKeys.map((key) => {
                        const isOn = client.featureOverrides![key];
                        return (
                          <span key={key} style={{
                            fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                            background: isOn ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                            color: isOn ? "#16a34a" : "#ef4444",
                          }}>
                            {FEATURES[key].label}: {isOn ? "ON" : "OFF"}
                          </span>
                        );
                      })}
                    </div>
                    <div>
                      <button
                        onClick={() => openModal(client)}
                        style={{
                          padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                          background: "transparent", border: "1px solid var(--cc-border)",
                          color: "var(--cc-text)", cursor: "pointer",
                        }}
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Bulk action floating bar */}
      {selected.size > 0 && (
        <div style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 24px",
          borderRadius: 12,
          background: "var(--cc-text)",
          color: "white",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          zIndex: 100,
          fontSize: 13,
        }}>
          <span style={{ fontWeight: 600 }}>
            {selected.size} client{selected.size > 1 ? "s" : ""} selected
          </span>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)" }} />
          <select
            value={bulkPlanId}
            onChange={(e) => setBulkPlanId(e.target.value)}
            style={{
              padding: "6px 10px", borderRadius: 6, fontSize: 12,
              background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)",
              color: "white", outline: "none",
            }}
          >
            <option value="">No Plan</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleBulkAssign}
            disabled={bulkSaving}
            style={{
              padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: "var(--cc-primary)", border: "none", color: "white",
              cursor: bulkSaving ? "not-allowed" : "pointer", opacity: bulkSaving ? 0.6 : 1,
            }}
          >
            Assign Plan
          </button>
          <button
            onClick={handleBulkClearOverrides}
            disabled={bulkSaving}
            style={{
              padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: "#ef4444", border: "none", color: "white",
              cursor: bulkSaving ? "not-allowed" : "pointer", opacity: bulkSaving ? 0.6 : 1,
            }}
          >
            Clear Overrides
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{
              padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
              background: "transparent", border: "1px solid rgba(255,255,255,0.3)",
              color: "rgba(255,255,255,0.8)", cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Client Feature Modal */}
      {selectedClient && (
        <ClientFeatureModal
          open={showModal}
          onClose={() => setShowModal(false)}
          client={selectedClient}
          plans={plans}
          onSave={handleSaveClient}
        />
      )}
    </div>
  );
}
