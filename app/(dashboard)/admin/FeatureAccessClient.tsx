"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ExternalLink, ArrowRight, Settings } from "lucide-react";
import Link from "next/link";
import { Button, Input, Badge, EmptyState, Card, Avatar } from "@pratham7711/ui";
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
    <div className="rsp-page page-enter">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
            Feature Access
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Manage plan assignments and feature overrides per client
          </p>
        </div>
        <Badge variant="accent" size="md">
          {initialClients.length} clients
        </Badge>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSelected(new Set()); }}
            className="cc-filter-tab"
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
      <div style={{ marginBottom: 24 }}>
        <Input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          iconLeft={<Search size={16} />}
        />
      </div>

      {/* Tab: All Clients */}
      {tab === "all" && (
        <Card variant="outlined" noPadding>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Search size={32} color="var(--cc-text-subtle)" />}
              title="No clients found"
              description="Try adjusting your search"
            />
          ) : (
            <div className="rsp-table-wrap">
            <div style={{ minWidth: 720 }}>
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
                    className="cc-table-row"
                    style={{
                      padding: "12px 20px",
                      borderBottom: "1px solid var(--cc-border)",
                      display: "grid",
                      gridTemplateColumns: "32px 1fr 140px 130px 110px 120px",
                      gap: 12,
                      alignItems: "center",
                      background: isSelected ? "var(--cc-row-hover)" : "transparent",
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
                      <Avatar name={client.name} size="sm" />
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{client.name}</span>
                    </div>

                    <div>
                      <Badge variant={client.planName ? "accent" : "neutral"} size="sm">
                        {client.planName || "No Plan"}
                      </Badge>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{enabledCount}/{featureKeys.length}</span>
                      <div style={{ flex: 1, maxWidth: 60, height: 4, borderRadius: 2, background: "var(--cc-hover-bg)", overflow: "hidden" }}>
                        <div style={{ width: `${(enabledCount / featureKeys.length) * 100}%`, height: "100%", borderRadius: 2, background: enabledCount > 7 ? "var(--cc-success)" : enabledCount > 4 ? "var(--cc-warning)" : "var(--cc-danger)", transition: "width 0.3s" }} />
                      </div>
                    </div>

                    <div>
                      {overrideCount > 0 && (
                        <Badge variant="warning" size="sm">
                          {overrideCount} override{overrideCount > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 6 }}>
                      <Button variant="ghost" size="sm" onClick={() => openModal(client)}>
                        Manage
                      </Button>
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
            </div>
            </div>
          )}
        </Card>
      )}

      {/* Tab: By Plan */}
      {tab === "by-plan" && (
        <div className="cc-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
          {(() => {
            const noPlanClients = filtered.filter((c) => !c.planId);
            if (noPlanClients.length === 0) return null;
            return (
              <Card variant="outlined" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>No Plan</h3>
                  <Badge variant="neutral" size="sm">
                    {noPlanClients.length} client{noPlanClients.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {noPlanClients.map((c) => (
                    <div key={c.id} title={c.name} onClick={() => openModal(c)} style={{ cursor: "pointer" }}>
                      <Avatar name={c.name} size="sm" />
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}

          {plans.map((plan) => {
            const clientsOnPlan = filtered.filter((c) => c.planId === plan.id);
            if (clientsOnPlan.length === 0) return null;
            return (
              <Card key={plan.id} variant="outlined" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>{plan.name}</h3>
                  <Badge variant="accent" size="sm">
                    {clientsOnPlan.length} client{clientsOnPlan.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {clientsOnPlan.map((c) => (
                    <div key={c.id} title={c.name} onClick={() => openModal(c)} style={{ cursor: "pointer" }}>
                      <Avatar name={c.name} size="sm" />
                    </div>
                  ))}
                </div>
                <Link href="/plans" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 12, color: "var(--cc-primary)", textDecoration: "none" }}>
                  View all <ArrowRight size={14} />
                </Link>
              </Card>
            );
          })}
        </div>
      )}

      {/* Tab: Overrides Only */}
      {tab === "overrides" && (
        <Card variant="outlined" noPadding>
          {clientsWithOverrides.length === 0 ? (
            <EmptyState
              icon={<Settings size={32} color="var(--cc-text-subtle)" />}
              title="No overrides"
              description="No clients have custom feature overrides"
            />
          ) : (
            <div className="rsp-table-wrap">
            <div style={{ minWidth: 640 }}>
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
                  <div key={client.id} className="cc-table-row" style={{
                    padding: "12px 20px", borderBottom: "1px solid var(--cc-border)",
                    display: "grid", gridTemplateColumns: "1fr 140px 1fr 100px", gap: 12, alignItems: "center",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={client.name} size="sm" />
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{client.name}</span>
                    </div>
                    <div>
                      <Badge variant={client.planName ? "accent" : "neutral"} size="sm">
                        {client.planName || "No Plan"}
                      </Badge>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {overriddenKeys.map((key) => {
                        const isOn = client.featureOverrides![key];
                        return (
                          <Badge key={key} variant={isOn ? "success" : "danger"} size="sm">
                            {FEATURES[key].label}: {isOn ? "ON" : "OFF"}
                          </Badge>
                        );
                      })}
                    </div>
                    <div>
                      <Button variant="ghost" size="sm" onClick={() => openModal(client)}>
                        Manage
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          )}
        </Card>
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
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "12px 24px",
          borderRadius: 12,
          background: "#1E1B4B",
          color: "white",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          zIndex: 100,
          fontSize: 13,
          maxWidth: "calc(100vw - 24px)",
        }}>
          <span style={{ fontWeight: 600 }}>
            {selected.size} client{selected.size > 1 ? "s" : ""} selected
          </span>
          <div className="rsp-hide-mobile" style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)" }} />
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
          <Button variant="primary" size="sm" loading={bulkSaving} onClick={handleBulkAssign}>
            Assign Plan
          </Button>
          <Button variant="danger" size="sm" loading={bulkSaving} onClick={handleBulkClearOverrides}>
            Clear Overrides
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} style={{ color: "rgba(255,255,255,0.8)" }}>
            Cancel
          </Button>
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
