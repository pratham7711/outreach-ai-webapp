"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { Building2, Settings2, Briefcase, Edit3, ClipboardList, ToggleRight } from "lucide-react";
import { Avatar, EmptyState, Input, Textarea } from "@pratham7711/ui";
import {
  Button,
  DataTable,
  Field,
  FieldRow,
  LoadError,
  PageHeader,
  SectionCard,
  SettingsForm,
  StatusBadge,
  StatusTabs,
  type DataTableColumn,
} from "@/components/ds";
import { useDirty } from "@/lib/useDirty";
import { FEATURES, type FeatureKey, clientHasFeature } from "@/lib/features";
import ClientFeatureModal from "@/components/modals/ClientFeatureModal";
import { formatDateAbs, formatFull } from "@/lib/format";
import { campaignStatusLabel } from "@/lib/statusColors";
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

type EditForm = {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  industry: string;
  website: string;
  notes: string;
};

type Tab = "overview" | "campaigns" | "edit" | "features";

const featureKeys = Object.keys(FEATURES) as FeatureKey[];

function formatCurrency(n: number, c = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(n);
}

function parseContact(raw: unknown): Record<string, string> {
  if (!raw) return {};
  try { return typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, string>); } catch { return {}; }
}

function formFromContact(name: string, contact: Record<string, string>): EditForm {
  return {
    name,
    contactPerson: contact.contactPerson ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    industry: contact.industry ?? "",
    website: contact.website ?? "",
    notes: contact.notes ?? "",
  };
}

const FACT_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))",
  columnGap: 32,
  rowGap: 20,
  margin: 0,
};
const FACT_LABEL: React.CSSProperties = {
  fontSize: "var(--cc-t-12)",
  color: "var(--cc-text-muted)",
  marginBottom: 4,
};
const FACT_VALUE: React.CSSProperties = {
  fontSize: "var(--cc-t-14)",
  fontWeight: "var(--cc-fw-medium)",
  color: "var(--cc-text)",
  margin: 0,
  overflowWrap: "anywhere",
};

export default function ClientDetailClient({ client, plans }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaignsFailed, setCampaignsFailed] = useState(false);

  const contact = parseContact(client.contactInfo);

  /* What the server last confirmed, and what is in the fields. Save and Cancel
     wait for the two to differ. */
  const [saved, setSaved] = useState<EditForm>(() => formFromContact(client.name, contact));
  const [editForm, setEditForm] = useState<EditForm>(saved);
  const dirty = useDirty(saved, editForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nameError = !editForm.name.trim() ? "Enter the company's name." : undefined;
  const set = (key: keyof EditForm, value: string) => setEditForm((f) => ({ ...f, [key]: value }));

  const loadCampaigns = useCallback(() => {
    setLoadingCampaigns(true);
    setCampaignsFailed(false);
    fetch(`/api/clients/${client.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => setCampaigns(data.campaigns ?? []))
      /* A failed read is said as one, not drawn as "No campaigns". */
      .catch(() => setCampaignsFailed(true))
      .finally(() => setLoadingCampaigns(false));
  }, [client.id]);

  useEffect(() => {
    if (activeTab === "campaigns" && campaigns.length === 0 && !campaignsFailed) loadCampaigns();
  }, [activeTab, campaigns.length, campaignsFailed, loadCampaigns]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const sent = editForm;
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sent.name,
          contactInfo: {
            contactPerson: sent.contactPerson,
            email: sent.email,
            phone: sent.phone,
            industry: sent.industry,
            website: sent.website,
            notes: sent.notes,
          },
        }),
      });
      if (res.ok) {
        setSaved(sent);
        toast.success("Client updated");
        router.refresh();
      } else {
        const err = await res.json().catch(() => null);
        setSaveError(err?.error ?? "The client couldn't be saved. Try again.");
      }
    } catch {
      setSaveError("The client couldn't be saved. Try again.");
    } finally { setSaving(false); }
  };

  const showBudget = campaigns.some((c) => c.budget);
  const campaignColumns: DataTableColumn<CampaignSummary>[] = [
    {
      key: "title",
      header: "Campaign",
      minWidth: 200,
      primary: true,
      truncate: (c) => c.title,
      render: (c) => c.title,
    },
    {
      key: "status",
      header: "Status",
      width: 160,
      render: (c) => <StatusBadge status={c.status}>{campaignStatusLabel(c.status)}</StatusBadge>,
    },
    /* Budget is optional, so the column exists only when one of this
       client's campaigns actually records one. */
    ...(showBudget
      ? [{
          key: "budget",
          header: "Budget",
          width: 140,
          align: "right" as const,
          render: (c: CampaignSummary) => (c.budget ? formatCurrency(Number(c.budget), c.currency) : "—"),
        }]
      : []),
    {
      key: "created",
      header: "Created",
      width: 140,
      render: (c) => formatDateAbs(c.createdAt),
    },
    {
      key: "creators",
      header: "Creators",
      width: 120,
      align: "right",
      render: (c) => formatFull(c._count.activations),
    },
  ];

  const enabledCount = featureKeys.filter((k) =>
    clientHasFeature(client.plan ? { features: client.plan.features } : null, client.featureOverrides, k),
  ).length;
  const overrideCount = client.featureOverrides ? Object.keys(client.featureOverrides).length : 0;

  return (
    <div className="rsp-page">
      <PageHeader
        title={client.name}
        back={{ href: "/clients", label: "Clients" }}
        leading={<Avatar name={client.name} size="md" src={client.logoUrl ?? undefined} />}
        meta={
          <>
            <span>{formatFull(client.campaignCount)} campaign{client.campaignCount !== 1 ? "s" : ""}</span>
            {contact.contactPerson ? <span>{contact.contactPerson}</span> : null}
            {contact.email ? <span>{contact.email}</span> : null}
            {contact.industry ? <span>{contact.industry}</span> : null}
            <span>{client.plan ? `${client.plan.name} plan` : "No plan assigned"}</span>
          </>
        }
        tabs={
          <StatusTabs
            ariaLabel="Client sections"
            idBase="client"
            tabs={[
              { key: "overview", label: "Overview", icon: <Building2 size={16} aria-hidden="true" /> },
              { key: "campaigns", label: "Campaigns", icon: <Briefcase size={16} aria-hidden="true" /> },
              { key: "edit", label: "Edit", icon: <Edit3 size={16} aria-hidden="true" /> },
              { key: "features", label: "Feature access", icon: <Settings2 size={16} aria-hidden="true" /> },
            ]}
            active={activeTab}
            onChange={(key) => setActiveTab(key as Tab)}
          />
        }
      />

      <div role="tabpanel" id="client-panel" aria-labelledby={`client-tab-${activeTab}`}>
        {activeTab === "overview" && (
          <SectionCard icon={Building2} title="Client details">
            <dl style={FACT_GRID}>
              {[
                { label: "Name", value: client.name },
                { label: "Contact person", value: contact.contactPerson || "—" },
                { label: "Email", value: contact.email || "—" },
                { label: "Phone", value: contact.phone || "—" },
                { label: "Industry", value: contact.industry || "—" },
                { label: "Website", value: contact.website || "—" },
                { label: "Plan", value: client.plan?.name || "No plan assigned" },
              ].map((row) => (
                <div key={row.label} style={{ minWidth: 0 }}>
                  <dt style={FACT_LABEL}>{row.label}</dt>
                  <dd style={FACT_VALUE}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        )}

        {activeTab === "campaigns" && (
          campaignsFailed ? (
            <LoadError
              title="We couldn't load this client's campaigns"
              description="The campaigns were not read, which is not the same as there being none."
              onRetry={loadCampaigns}
              retrying={loadingCampaigns}
            />
          ) : (
            <DataTable
              caption={`Campaigns for ${client.name}`}
              columns={campaignColumns}
              rows={campaigns}
              rowKey={(c) => c.id}
              rowHref={(c) => `/campaigns/${c.id}`}
              loading={loadingCampaigns}
              skeletonRows={4}
              empty={
                <EmptyState
                  icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />}
                  title="No campaigns"
                  description="This client has no campaigns yet."
                />
              }
            />
          )
        )}

        {activeTab === "edit" && (
          <SettingsForm
            icon={Edit3}
            title="Edit client"
            description="Company name and contact details"
            dirty={dirty}
            saving={saving}
            invalid={Boolean(nameError)}
            onSubmit={handleSave}
            onCancel={() => {
              setEditForm(saved);
              setSaveError(null);
            }}
            status={saveError ? <span className="cc-form-error" role="alert">{saveError}</span> : null}
          >
            <Field label="Company name" required error={nameError}>
              <Input value={editForm.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Contact person">
              <Input value={editForm.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />
            </Field>
            <FieldRow>
              <Field label="Email">
                <Input type="email" value={editForm.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={editForm.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Industry">
                <Input value={editForm.industry} onChange={(e) => set("industry", e.target.value)} />
              </Field>
              <Field label="Website">
                <Input inputMode="url" value={editForm.website} onChange={(e) => set("website", e.target.value)} />
              </Field>
            </FieldRow>
            <Field label="Notes">
              <Textarea value={editForm.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </Field>
          </SettingsForm>
        )}

        {activeTab === "features" && (
          <SectionCard
            icon={ToggleRight}
            title="Feature access"
            description={`${client.plan ? `${client.plan.name} plan` : "No plan assigned"} · ${enabledCount} of ${featureKeys.length} enabled${overrideCount > 0 ? ` · ${overrideCount} override${overrideCount > 1 ? "s" : ""} active` : ""}`}
            action={
              <Button variant="secondary" size="sm" iconLeft={<Settings2 size={16} aria-hidden="true" />} onClick={() => setShowFeatureModal(true)}>
                Manage access
              </Button>
            }
            padded={false}
          >
            {featureKeys.map((key, i) => {
              const planVal = client.plan?.features?.[key] ?? false;
              const overrideVal = client.featureOverrides?.[key];
              const effective = clientHasFeature(client.plan ? { features: client.plan.features } : null, client.featureOverrides, key);
              const isOverridden = overrideVal !== undefined;
              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 20px",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-medium)", color: effective ? "var(--cc-text)" : "var(--cc-text-muted)" }}>{FEATURES[key].label}</div>
                    <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{FEATURES[key].description}</div>
                  </div>
                  {isOverridden ? (
                    <StatusBadge tone={overrideVal ? "success" : "danger"} title="Set on this client, overriding the plan">
                      Override: {overrideVal ? "on" : "off"}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone={planVal ? "success" : "neutral"} title="From the client's plan">
                      Plan: {planVal ? "on" : "off"}
                    </StatusBadge>
                  )}
                </div>
              );
            })}
          </SectionCard>
        )}
      </div>

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
