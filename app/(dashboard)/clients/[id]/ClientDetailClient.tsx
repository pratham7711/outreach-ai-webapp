"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Save, Building2, Settings2 } from "lucide-react";
import { FEATURES, type FeatureKey, clientHasFeature } from "@/lib/features";
import ClientFeatureModal from "@/components/modals/ClientFeatureModal";

type Plan = { id: string; name: string; features: Record<string, boolean> };

type ClientProps = {
  id: string;
  name: string;
  logoUrl: string | null;
  contactInfo: unknown;
  planId: string | null;
  featureOverrides: Record<string, boolean> | null;
  campaignCount: number;
  plan: Plan | null;
};

type Props = {
  client: ClientProps;
  plans: Plan[];
};

const featureKeys = Object.keys(FEATURES) as FeatureKey[];

export default function ClientDetailClient({ client, plans }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"overview" | "features">("overview");
  const [showFeatureModal, setShowFeatureModal] = useState(false);

  const tabs = [
    { key: "overview" as const, label: "Overview", icon: Building2 },
    { key: "features" as const, label: "Feature Access", icon: Settings2 },
  ];

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Breadcrumb */}
      <Link
        href="/clients"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--cc-text-muted)", textDecoration: "none", marginBottom: 24 }}
      >
        <ArrowLeft size={14} />
        Back to Clients
      </Link>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, background: "#EEF2FF", color: "#5B5BD6" }}>
          {client.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 2 }}>{client.name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
              {client.campaignCount} campaign{client.campaignCount !== 1 ? "s" : ""}
            </span>
            {client.plan && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                background: "rgba(91,91,214,0.1)", color: "#5B5BD6",
              }}>
                {client.plan.name}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--cc-border)" }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 16px", fontSize: 13, fontWeight: active ? 600 : 500,
                color: active ? "var(--cc-primary)" : "var(--cc-text-muted)",
                background: "none", border: "none", cursor: "pointer",
                borderBottom: active ? "2px solid var(--cc-primary)" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div style={{ maxWidth: 640 }}>
          <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16 }}>Client Details</h3>

            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Name</div>
                <div style={{ fontSize: 14, color: "var(--cc-text)" }}>{client.name}</div>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Plan</div>
                <div style={{ fontSize: 14, color: "var(--cc-text)" }}>
                  {client.plan ? (
                    <span style={{
                      fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                      background: "rgba(91,91,214,0.1)", color: "#5B5BD6",
                    }}>
                      {client.plan.name}
                    </span>
                  ) : (
                    <span style={{ color: "var(--cc-text-muted)" }}>No plan assigned</span>
                  )}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Campaigns</div>
                <div style={{ fontSize: 14, color: "var(--cc-text)" }}>{client.campaignCount}</div>
              </div>

              {client.contactInfo != null && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Contact</div>
                  <div style={{ fontSize: 14, color: "var(--cc-text)" }}>
                    {(() => {
                      const raw = String(client.contactInfo);
                      try { const c = JSON.parse(raw); return (c.email as string) || raw; } catch { return raw; }
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Feature Access Tab */}
      {activeTab === "features" && (
        <div style={{ maxWidth: 640 }}>
          {/* Current plan card */}
          <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 4 }}>Current Plan</div>
                {client.plan ? (
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
                    background: "rgba(91,91,214,0.1)", color: "#5B5BD6",
                  }}>
                    {client.plan.name}
                  </span>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No plan assigned</span>
                )}
              </div>
              <button
                onClick={() => setShowFeatureModal(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: "var(--cc-primary)", border: "none", color: "white", cursor: "pointer",
                }}
              >
                <Settings2 size={14} />
                Manage Access
              </button>
            </div>

            {client.featureOverrides && Object.keys(client.featureOverrides).length > 0 && (
              <div style={{
                fontSize: 12, padding: "6px 12px", borderRadius: 6,
                background: "rgba(234,179,8,0.08)", color: "#d97706",
                border: "1px solid rgba(234,179,8,0.15)",
              }}>
                {Object.keys(client.featureOverrides).length} feature override{Object.keys(client.featureOverrides).length > 1 ? "s" : ""} active
              </div>
            )}
          </div>

          {/* Feature list */}
          <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--cc-border)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--cc-text-muted)" }}>
              All Features ({featureKeys.filter((k) => clientHasFeature(client.plan ? { features: client.plan.features } : null, client.featureOverrides, k)).length}/{featureKeys.length} enabled)
            </div>
            {featureKeys.map((key, i) => {
              const planVal = client.plan?.features?.[key] ?? false;
              const overrideVal = client.featureOverrides?.[key];
              const effective = clientHasFeature(
                client.plan ? { features: client.plan.features } : null,
                client.featureOverrides,
                key
              );
              const isOverridden = overrideVal !== undefined;

              return (
                <div
                  key={key}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 20px",
                    borderBottom: i < featureKeys.length - 1 ? "1px solid var(--cc-border)" : "none",
                    background: isOverridden ? "rgba(91,91,214,0.02)" : "transparent",
                  }}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: effective ? "#22c55e" : "#D1D5DB",
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: effective ? "var(--cc-text)" : "var(--cc-text-muted)" }}>
                      {FEATURES[key].label}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                      {FEATURES[key].description}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isOverridden && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                        background: overrideVal ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        color: overrideVal ? "#16a34a" : "#ef4444",
                      }}>
                        Override: {overrideVal ? "ON" : "OFF"}
                      </span>
                    )}
                    {!isOverridden && (
                      <span style={{
                        fontSize: 10, fontWeight: 500, color: "var(--cc-text-muted)",
                      }}>
                        Plan: {planVal ? "ON" : "OFF"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Client Feature Modal */}
      <ClientFeatureModal
        open={showFeatureModal}
        onClose={() => setShowFeatureModal(false)}
        client={{
          id: client.id,
          name: client.name,
          planId: client.planId,
          featureOverrides: client.featureOverrides,
        }}
        plans={plans}
        onSave={() => {
          setShowFeatureModal(false);
          router.refresh();
        }}
      />
    </div>
  );
}
