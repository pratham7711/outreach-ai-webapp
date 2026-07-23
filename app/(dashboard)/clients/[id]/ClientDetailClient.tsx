"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { ArrowLeft, Save, Building2, Settings2, Briefcase, Edit3, ClipboardList } from "lucide-react";
import { Card, Button, Badge, StatCard, Avatar, EmptyState, Input } from "@pratham7711/ui";
import { FEATURES, type FeatureKey, clientHasFeature } from "@/lib/features";
import ClientFeatureModal from "@/components/modals/ClientFeatureModal";
import { formatDateAbs } from "@/lib/format";
import { toast } from "sonner";

type Plan = { id: string; name: string; features: Record<string, boolean> };

type CampaignSummary = {
  id: string; title: string; status: string; budget: number | null; currency: string;
  createdAt: string; _count: { activations: number };
};

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

const STATUS_BADGE: Record<string, "success" | "warning" | "accent" | "neutral"> = {
  DRAFT: "neutral", PENDING: "warning", IN_PROGRESS: "accent", COMPLETE: "success", CANCELLED: "neutral",
};

function formatCurrency(n: number, c = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(n);
}

function parseContact(raw: unknown): Record<string, string> {
  if (!raw) return {};
  try { return typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, string>); } catch { return {}; }
}

export default function ClientDetailClient({ client, plans }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"overview" | "campaigns" | "edit" | "features">("overview");
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);

  // Edit form
  const contact = parseContact(client.contactInfo);
  const [editForm, setEditForm] = useState({
    name: client.name,
    contactPerson: contact.contactPerson ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    industry: contact.industry ?? "",
    website: contact.website ?? "",
    notes: contact.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (activeTab === "campaigns" && campaigns.length === 0) {
      setLoadingCampaigns(true);
      fetch(`/api/clients/${client.id}`)
        .then(r => r.json())
        .then(data => setCampaigns(data.campaigns ?? []))
        .finally(() => setLoadingCampaigns(false));
    }
  }, [activeTab, client.id, campaigns.length]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          contactInfo: {
            contactPerson: editForm.contactPerson,
            email: editForm.email,
            phone: editForm.phone,
            industry: editForm.industry,
            website: editForm.website,
            notes: editForm.notes,
          },
        }),
      });
      if (res.ok) {
        toast.success("Client updated");
        router.refresh();
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to save");
      }
    } finally { setSaving(false); }
  };

  const tabs = [
    { key: "overview" as const, label: "Overview", icon: Building2 },
    { key: "campaigns" as const, label: "Campaigns", icon: Briefcase },
    { key: "edit" as const, label: "Edit", icon: Edit3 },
    { key: "features" as const, label: "Feature Access", icon: Settings2 },
  ];

  return (
    <div className="rsp-page">
      <Link href="/clients" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--cc-text-muted)", textDecoration: "none", marginBottom: 24 }}>
        <ArrowLeft size={14} /> Back to Clients
      </Link>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <Avatar name={client.name} size="lg" style={{ width: 56, height: 56, fontSize: 18, borderRadius: 14 }} />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 2 }}>{client.name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{client.campaignCount} campaign{client.campaignCount !== 1 ? "s" : ""}</span>
            {contact.industry && <Badge variant="neutral">{contact.industry}</Badge>}
            {client.plan && <Badge variant="accent">{client.plan.name}</Badge>}
          </div>
        </div>
      </div>

      {/* Stats */}
      <style>{`
        .client-stats .ui-statcard { min-width: 0; }
        .client-stats .ui-statcard-value { font-size: clamp(20px, 4vw, 30px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      `}</style>
      <div className="rsp-grid-3 client-stats" style={{ marginBottom: 32 }}>
        <StatCard value={String(client.campaignCount)} label="Campaigns" />
        <StatCard value={contact.email || "—"} label="Contact Email" />
        <StatCard value={contact.contactPerson || "—"} label="Contact Person" />
      </div>

      {/* Tab nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--cc-border)", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0,
              padding: "10px 16px", fontSize: 13, fontWeight: active ? 600 : 500,
              color: active ? "var(--cc-primary)" : "var(--cc-text-muted)",
              background: "none", border: "none", cursor: "pointer",
              borderBottom: active ? "2px solid var(--cc-primary)" : "2px solid transparent", marginBottom: -1,
            }}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div style={{ maxWidth: 640 }}>
          <Card variant="outlined" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16 }}>Client Details</h3>
            <div style={{ display: "grid", gap: 16 }}>
              {[
                { label: "Name", value: client.name },
                { label: "Contact Person", value: contact.contactPerson || "—" },
                { label: "Email", value: contact.email || "—" },
                { label: "Phone", value: contact.phone || "—" },
                { label: "Industry", value: contact.industry || "—" },
                { label: "Website", value: contact.website || "—" },
                { label: "Plan", value: client.plan?.name || "No plan assigned" },
              ].map(row => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--cc-border)" }}>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{row.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Campaigns Tab */}
      {activeTab === "campaigns" && (
        loadingCampaigns ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--cc-text-muted)" }}>Loading campaigns...</div>
        ) : campaigns.length === 0 ? (
          <EmptyState icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />} title="No campaigns" description="This client has no campaigns yet." />
        ) : (
          <Card variant="solid" noPadding>
            <div className="rsp-table-wrap">
              <div style={{ minWidth: 560 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 100px 80px", gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)" }}>
                  {["Campaign", "Status", "Budget", "Date", "Creators"].map(h => (
                    <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                  ))}
                </div>
                {campaigns.map((c, i) => (
                  <Link key={c.id} href={`/campaigns/${c.id}`} style={{ textDecoration: "none", display: "grid", gridTemplateColumns: "1fr 100px 100px 100px 80px", gap: 12, padding: "14px 24px", alignItems: "center", borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }} className="cc-table-row">
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{c.title}</span>
                    <Badge variant={STATUS_BADGE[c.status] ?? "neutral"} dot>{c.status.replace(/_/g, " ")}</Badge>
                    <span style={{ fontSize: 13, color: "var(--cc-text)" }}>{c.budget ? formatCurrency(Number(c.budget), c.currency) : "—"}</span>
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{formatDateAbs(c.createdAt)}</span>
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{c._count.activations}</span>
                  </Link>
                ))}
              </div>
            </div>
          </Card>
        )
      )}

      {/* Edit Tab */}
      {activeTab === "edit" && (
        <div style={{ maxWidth: 640 }}>
          <Card variant="outlined" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 20 }}>Edit Client</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Input label="Company Name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              <Input label="Contact Person" value={editForm.contactPerson} onChange={e => setEditForm(f => ({ ...f, contactPerson: e.target.value }))} />
              <div className="rsp-grid-2">
                <Input label="Email" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                <Input label="Phone" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="rsp-grid-2">
                <Input label="Industry" value={editForm.industry} onChange={e => setEditForm(f => ({ ...f, industry: e.target.value }))} />
                <Input label="Website" value={editForm.website} onChange={e => setEditForm(f => ({ ...f, website: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button variant="primary" iconLeft={<Save size={14} />} loading={saving} onClick={handleSave}>Save Changes</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Feature Access Tab */}
      {activeTab === "features" && (
        <div style={{ maxWidth: 640 }}>
          <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 4 }}>Current Plan</div>
                {client.plan ? <Badge variant="accent">{client.plan.name}</Badge> : <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No plan assigned</span>}
              </div>
              <Button variant="primary" size="sm" iconLeft={<Settings2 size={14} />} onClick={() => setShowFeatureModal(true)}>Manage Access</Button>
            </div>
            {client.featureOverrides && Object.keys(client.featureOverrides).length > 0 && (
              <div style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, background: "color-mix(in srgb, var(--cc-warning) 12%, transparent)", color: "var(--cc-warning)", border: "1px solid color-mix(in srgb, var(--cc-warning) 25%, transparent)" }}>
                {Object.keys(client.featureOverrides).length} override{Object.keys(client.featureOverrides).length > 1 ? "s" : ""} active
              </div>
            )}
          </div>

          <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--cc-border)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--cc-text-muted)" }}>
              All Features ({featureKeys.filter(k => clientHasFeature(client.plan ? { features: client.plan.features } : null, client.featureOverrides, k)).length}/{featureKeys.length} enabled)
            </div>
            {featureKeys.map((key, i) => {
              const planVal = client.plan?.features?.[key] ?? false;
              const overrideVal = client.featureOverrides?.[key];
              const effective = clientHasFeature(client.plan ? { features: client.plan.features } : null, client.featureOverrides, key);
              const isOverridden = overrideVal !== undefined;
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: i < featureKeys.length - 1 ? "1px solid var(--cc-border)" : "none", background: isOverridden ? "var(--cc-primary-light)" : "transparent" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: effective ? "#22c55e" : "#D1D5DB" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: effective ? "var(--cc-text)" : "var(--cc-text-muted)" }}>{FEATURES[key].label}</div>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{FEATURES[key].description}</div>
                  </div>
                  {isOverridden ? (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: overrideVal ? "color-mix(in srgb, var(--cc-success) 14%, transparent)" : "color-mix(in srgb, var(--cc-danger) 14%, transparent)", color: overrideVal ? "var(--cc-success)" : "var(--cc-danger)" }}>
                      Override: {overrideVal ? "ON" : "OFF"}
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 500, color: "var(--cc-text-muted)" }}>Plan: {planVal ? "ON" : "OFF"}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ClientFeatureModal
        open={showFeatureModal}
        onClose={() => setShowFeatureModal(false)}
        client={{ id: client.id, name: client.name, planId: client.planId, featureOverrides: client.featureOverrides }}
        plans={plans}
        onSave={() => { setShowFeatureModal(false); router.refresh(); }}
      />
    </div>
  );
}
