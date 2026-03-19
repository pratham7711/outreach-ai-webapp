"use client";

import { useState } from "react";
import { Button, Card, Badge } from "@pratham7711/ui";
import { Search, Plus, Settings } from "lucide-react";
import ClientFeatureModal from "@/components/modals/ClientFeatureModal";

const EmptyState = ({ icon, title, description }: { icon: string; title: string; description?: string }) => (
  <div style={{ textAlign: "center", padding: "40px 20px" }}>
    <div style={{ fontSize: 32, marginBottom: 16 }}>{icon}</div>
    <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "var(--cc-text)" }}>{title}</h3>
    {description && <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>{description}</p>}
  </div>
);

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

export default function FeatureAccessClient({ clients, plans }: FeatureAccessClientProps) {
  const [tab, setTab] = useState<"all" | "by-plan" | "overrides">("all");
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const clientsWithOverrides = filtered.filter((c) => c.featureOverrides && Object.keys(c.featureOverrides).length > 0);

  const openModal = (client: ClientData) => {
    setSelectedClient(client);
    setShowModal(true);
  };

  const handleSaveClient = () => {
    setShowModal(false);
    setSelectedClient(null);
    // In real app, would refresh data here
  };

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
              Feature Access
            </h1>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
              Manage plan assignments and feature overrides per client
            </p>
          </div>
          <Badge variant="accent">{clients.length} clients</Badge>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTab("all")} style={{
            opacity: tab === "all" ? 1 : 0.6,
            cursor: "pointer",
            padding: "8px 16px",
            borderRadius: "20px",
            background: tab === "all" ? "var(--cc-primary)" : "var(--cc-card)",
            color: tab === "all" ? "white" : "var(--cc-text)",
            border: `1px solid ${tab === "all" ? "var(--cc-primary)" : "var(--cc-border)"}`,
            fontSize: 14,
            fontWeight: 500,
          }}>
            All Clients
          </button>
          <button onClick={() => setTab("by-plan")} style={{
            opacity: tab === "by-plan" ? 1 : 0.6,
            cursor: "pointer",
            padding: "8px 16px",
            borderRadius: "20px",
            background: tab === "by-plan" ? "var(--cc-primary)" : "var(--cc-card)",
            color: tab === "by-plan" ? "white" : "var(--cc-text)",
            border: `1px solid ${tab === "by-plan" ? "var(--cc-primary)" : "var(--cc-border)"}`,
            fontSize: 14,
            fontWeight: 500,
          }}>
            By Plan
          </button>
          <button onClick={() => setTab("overrides")} style={{
            opacity: tab === "overrides" ? 1 : 0.6,
            cursor: "pointer",
            padding: "8px 16px",
            borderRadius: "20px",
            background: tab === "overrides" ? "var(--cc-primary)" : "var(--cc-card)",
            color: tab === "overrides" ? "white" : "var(--cc-text)",
            border: `1px solid ${tab === "overrides" ? "var(--cc-primary)" : "var(--cc-border)"}`,
            fontSize: 14,
            fontWeight: 500,
          }}>
            Overrides Only
          </button>
        </div>
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
          }}
        />
      </div>

      {/* Content based on tab */}
      {tab === "all" && (
        <Card variant="solid" noPadding>
          {filtered.length === 0 ? (
            <div style={{ padding: 40 }}>
              <EmptyState icon="🔍" title="No clients found" description="Try adjusting your search" />
            </div>
          ) : (
            <div style={{ overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--cc-border)", display: "grid", gridTemplateColumns: "1fr 150px 120px 100px 100px", gap: 16, fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)" }}>
                <div>CLIENT</div>
                <div>PLAN</div>
                <div>FEATURES</div>
                <div>OVERRIDES</div>
                <div>ACTIONS</div>
              </div>
              {filtered.map((client) => {
                const enabledCount = Object.values(client.planFeatures ?? {}).filter(Boolean).length;
                return (
                  <div key={client.id} style={{ padding: "14px 20px", borderBottom: "1px solid var(--cc-border)", display: "grid", gridTemplateColumns: "1fr 150px 120px 100px 100px", gap: 16, alignItems: "center", fontSize: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: "var(--cc-primary)",
                        color: "white",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                      }}>
                        {client.name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 500, color: "var(--cc-text)" }}>{client.name}</span>
                    </div>
                    <div>
                      {client.planName ? (
                        <Badge variant="accent">{client.planName}</Badge>
                      ) : (
                        <Badge variant="neutral">No Plan</Badge>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      {enabledCount}/10 features
                    </div>
                    <div>
                      {client.featureOverrides && Object.keys(client.featureOverrides).length > 0 && (
                        <Badge variant="warning">{Object.keys(client.featureOverrides).length} overrides</Badge>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button size="sm" variant="ghost" onClick={() => openModal(client)}>
                        Manage
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === "by-plan" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
          {/* No Plan section */}
          {filtered.filter((c) => !c.planId).length > 0 && (
            <Card variant="solid">
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--cc-text)", marginBottom: 4 }}>No Plan</h3>
                <Badge variant="neutral">{filtered.filter((c) => !c.planId).length} clients</Badge>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {filtered.filter((c) => !c.planId).map((c) => (
                  <div key={c.id} title={c.name} style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "var(--cc-primary)",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}>
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Plan sections */}
          {plans.map((plan) => {
            const clientsOnPlan = filtered.filter((c) => c.planId === plan.id);
            if (clientsOnPlan.length === 0) return null;
            return (
              <Card key={plan.id} variant="solid">
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--cc-text)", marginBottom: 4 }}>
                    {plan.name}
                  </h3>
                  <Badge variant="accent">{clientsOnPlan.length} clients</Badge>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {clientsOnPlan.map((c) => (
                    <div key={c.id} title={c.name} style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "var(--cc-primary)",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}>
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "overrides" && (
        <Card variant="solid" noPadding>
          {clientsWithOverrides.length === 0 ? (
            <div style={{ padding: 40 }}>
              <EmptyState icon="⚙️" title="No overrides" description="No clients have custom feature overrides" />
            </div>
          ) : (
            <div style={{ overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--cc-border)", display: "grid", gridTemplateColumns: "1fr 150px 150px", gap: 16, fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)" }}>
                <div>CLIENT</div>
                <div>PLAN</div>
                <div>ACTIONS</div>
              </div>
              {clientsWithOverrides.map((client) => (
                <div key={client.id} style={{ padding: "14px 20px", borderBottom: "1px solid var(--cc-border)", display: "grid", gridTemplateColumns: "1fr 150px 150px", gap: 16, alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: "var(--cc-primary)",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                    }}>
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontWeight: 500 }}>{client.name}</span>
                  </div>
                  <Badge variant="accent">{client.planName || "No Plan"}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => openModal(client)}>
                    Manage
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
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
