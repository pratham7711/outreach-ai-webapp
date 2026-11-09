"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Settings, Layers } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@pratham7711/ui";
import ClientFeatureModal from "@/components/modals/ClientFeatureModal";
import { FEATURES, type FeatureKey } from "@/lib/features";
import {
  PageHeader,
  Dropdown,
  useConfirm,
  Button,
  StatusTabs,
  ListToolbar,
  DataTable,
  NoResults,
  SectionCard,
  StatusBadge,
  type DataTableColumn,
} from "@/components/ds";
import { toast } from "sonner";

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
  const confirm = useConfirm();
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
      } else {
        // A rejected bulk write used to clear nothing and say nothing, so the
        // selection stayed put and read as if the plan had been assigned.
        toast.error("Couldn't assign the plan. No client was changed.");
      }
    } catch {
      toast.error("The request didn't go through. No client was changed.");
    } finally {
      setBulkSaving(false);
    }
  }

  async function handleBulkClearOverrides() {
    if (selected.size === 0) return;
    /* Danger, not default: this is not a delete, but it throws away every
       per-client exception on the selection and there is no undo, so the
       dialog has to read as a loss rather than a routine change. The warning
       glyph (not the trash can) keeps it from reading as a delete. */
    const ok = await confirm({
      title: `Clear overrides for ${selected.size} ${selected.size === 1 ? "client" : "clients"}?`,
      description: "Each selected client falls back to whatever its assigned plan allows. Any per-client exceptions you set are lost. This can't be undone.",
      confirmLabel: "Clear overrides",
      tone: "danger",
    });
    if (!ok) return;
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
      } else {
        toast.error("Couldn't clear the overrides. No client was changed.");
      }
    } catch {
      toast.error("The request didn't go through. No client was changed.");
    } finally {
      setBulkSaving(false);
    }
  }

  const tabs = [
    { key: "all" as const, label: "All clients" },
    { key: "by-plan" as const, label: "By plan" },
    { key: "overrides" as const, label: "Overrides only" },
  ];

  const planBadge = (client: ClientData) => (
    <StatusBadge tone={client.planName ? "info" : "neutral"}>{client.planName || "No plan"}</StatusBadge>
  );

  const clientCell = (client: ClientData) => (
    <span className="cc-fa-client">
      <Avatar name={client.name} size="sm" />
      <span className="cc-dt-truncate">{client.name}</span>
    </span>
  );

  const manage = (client: ClientData) => (
    <Button variant="secondary" size="sm" onClick={() => openModal(client)} aria-label={`Manage ${client.name}`}>
      Manage
    </Button>
  );

  const emptyClients = (description: string) => (
    <NoResults
      icon={search ? undefined : <Layers size={32} strokeWidth={1.75} />}
      title={search ? "No results found" : "No clients yet"}
      description={search ? undefined : description}
      onClear={search ? () => setSearch("") : undefined}
      clearLabel="Clear search"
    />
  );

  const allColumns: DataTableColumn<ClientData>[] = [
    {
      key: "select",
      header: "Select",
      hideHeader: true,
      width: 48,
      render: (client) => (
        <input
          type="checkbox"
          className="cc-fa-check"
          checked={selected.has(client.id)}
          onChange={() => toggleSelect(client.id)}
          aria-label={`Select ${client.name}`}
        />
      ),
    },
    { key: "client", header: "Client", minWidth: 220, primary: true, render: clientCell },
    { key: "plan", header: "Plan", width: 160, render: planBadge },
    {
      key: "features",
      header: "Features",
      width: 150,
      render: (client) => {
        const enabled = getEnabledCount(client);
        return (
          <span className="cc-fa-features">
            <span className="cc-fa-features__count">
              {enabled}/{featureKeys.length}
            </span>
            <span className="cc-fa-meter" aria-hidden="true">
              <span className="cc-fa-meter__fill" style={{ width: `${(enabled / featureKeys.length) * 100}%` }} />
            </span>
          </span>
        );
      },
    },
    {
      key: "overrides",
      header: "Overrides",
      width: 130,
      render: (client) => {
        const n = getOverrideCount(client);
        return n > 0 ? <StatusBadge tone="warning">{n} override{n > 1 ? "s" : ""}</StatusBadge> : <span className="cc-fa-muted">None</span>;
      },
    },
    { key: "actions", header: "Actions", hideHeader: true, width: 112, align: "right", render: manage },
  ];

  const overrideColumns: DataTableColumn<ClientData>[] = [
    { key: "client", header: "Client", minWidth: 200, primary: true, render: clientCell },
    { key: "plan", header: "Plan", width: 160, render: planBadge },
    {
      key: "features",
      header: "Overridden features",
      minWidth: 240,
      render: (client) => (
        <span className="cc-fa-overrides">
          {featureKeys
            .filter((k) => client.featureOverrides?.[k] !== undefined)
            .map((key) => {
              const isOn = client.featureOverrides![key];
              return (
                <StatusBadge key={key} tone={isOn ? "success" : "danger"}>
                  {FEATURES[key].label}: {isOn ? "On" : "Off"}
                </StatusBadge>
              );
            })}
        </span>
      ),
    },
    { key: "actions", header: "Actions", hideHeader: true, width: 112, align: "right", render: manage },
  ];

  const planGroups: { id: string; name: string; clients: ClientData[]; onPlan: boolean }[] = [
    { id: "none", name: "No plan", clients: filtered.filter((c) => !c.planId), onPlan: false },
    ...plans.map((plan) => ({ id: plan.id, name: plan.name, clients: filtered.filter((c) => c.planId === plan.id), onPlan: true })),
  ].filter((g) => g.clients.length > 0);

  const allSelected = selected.size === filtered.length && filtered.length > 0;

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Feature access"
        subtitle={`${initialClients.length} ${initialClients.length === 1 ? "client" : "clients"} · plan assignments and feature overrides per client`}
        tabs={
          <StatusTabs
            ariaLabel="Feature access views"
            tabs={tabs}
            active={tab}
            onChange={(key) => { setTab(key as typeof tab); setSelected(new Set()); }}
          />
        }
      />

      <ListToolbar
        search={{ value: search, onChange: setSearch, placeholder: "Search clients", ariaLabel: "Search clients by name" }}
        end={
          tab === "all" && filtered.length > 0 ? (
            <label className="cc-fa-select-all">
              <input type="checkbox" className="cc-fa-check" checked={allSelected} onChange={toggleAll} />
              Select all
            </label>
          ) : null
        }
      />

      {tab === "all" && (
        <DataTable
          caption="Clients"
          columns={allColumns}
          rows={filtered}
          rowKey={(c) => c.id}
          stickyFirstColumn={false}
          empty={emptyClients("Clients you add show up here, with the plan and feature overrides that apply to each.")}
        />
      )}

      {/* Every group renders nothing when it holds no clients, so an org with
          no clients, or a search that matches none, needs its own message. */}
      {tab === "by-plan" && planGroups.length === 0 && (
        <SectionCard icon={Layers} title="Plans">
          {emptyClients("Add a client and it appears here, grouped by the plan it is on.")}
        </SectionCard>
      )}
      {tab === "by-plan" && planGroups.length > 0 && (
        <div className="cc-fa-plans cc-stagger">
          {planGroups.map((group) => (
            <SectionCard
              key={group.id}
              icon={Layers}
              title={group.name}
              description={`${group.clients.length} client${group.clients.length !== 1 ? "s" : ""}`}
              action={
                group.onPlan ? (
                  <Link href="/plans" className="cc-fa-plan-link">
                    View plans <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                ) : undefined
              }
            >
              <div className="cc-fa-avatars">
                {group.clients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="cc-fa-avatar-btn"
                    title={c.name}
                    aria-label={`Manage ${c.name}`}
                    onClick={() => openModal(c)}
                  >
                    <Avatar name={c.name} size="sm" />
                  </button>
                ))}
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      {tab === "overrides" && (
        <DataTable
          caption="Clients with feature overrides"
          columns={overrideColumns}
          rows={clientsWithOverrides}
          rowKey={(c) => c.id}
          stickyFirstColumn={false}
          empty={
            search ? (
              emptyClients("")
            ) : (
              <NoResults
                icon={<Settings size={32} strokeWidth={1.75} />}
                title="No overrides"
                description="No client has a custom feature override."
              />
            )
          }
        />
      )}

      {selected.size > 0 && (
        <div className="cc-fa-bulk" role="region" aria-label="Bulk actions">
          <span className="cc-fa-bulk__count">
            {selected.size} client{selected.size > 1 ? "s" : ""} selected
          </span>
          <span className="cc-fa-bulk__rule rsp-hide-mobile" aria-hidden="true" />
          <Dropdown
            ariaLabel="Bulk plan"
            align="left"
            minWidth={130}
            size="sm"
            value={bulkPlanId}
            onChange={setBulkPlanId}
            options={[
              { value: "", label: "No plan" },
              ...plans.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Button variant="primary" size="sm" loading={bulkSaving} onClick={handleBulkAssign}>
            Assign plan
          </Button>
          <Button variant="danger" size="sm" loading={bulkSaving} onClick={handleBulkClearOverrides}>
            Clear overrides
          </Button>
          <Button variant="ghost" size="sm" className="cc-fa-bulk__cancel" onClick={() => setSelected(new Set())}>
            Cancel
          </Button>
        </div>
      )}

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
