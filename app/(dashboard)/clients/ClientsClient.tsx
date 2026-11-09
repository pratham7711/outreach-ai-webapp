"use client";
import { useState } from "react";
import { Plus, Building2 } from "lucide-react";
import { Avatar, EmptyState } from "@pratham7711/ui";
import {
  PageHeader,
  MetricTile,
  Button,
  ListToolbar,
  DataTable,
  NoResults,
  type DataTableColumn,
} from "@/components/ds";
import AddClientModal from "@/components/modals/AddClientModal";
import { action } from "@/lib/ui/actions";
import { formatFull } from "@/lib/format";
import { CLIENTS_WIDTHS } from "./columns";

type Client = {
  id: string;
  name: string;
  logoUrl: string | null;
  contactInfo: unknown;
  _count: { campaigns: number };
};

/** contactInfo is stored as JSON, sometimes as a string of it. */
function parseContact(raw: unknown): Record<string, string> {
  if (!raw) return {};
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, string>);
  } catch {
    return {};
  }
}

const COLUMNS: DataTableColumn<Client>[] = [
  {
    key: "client",
    header: "Client",
    minWidth: 220,
    primary: true,
    render: (c) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12, minWidth: 0, maxWidth: "100%" }}>
        <Avatar name={c.name} size="sm" src={c.logoUrl ?? undefined} />
        <span className="cc-dt-truncate" title={c.name}>
          {c.name}
        </span>
      </span>
    ),
  },
  {
    key: "contact",
    header: "Contact",
    width: CLIENTS_WIDTHS.contact,
    render: (c) => {
      const contact = parseContact(c.contactInfo);
      const person = contact.contactPerson?.trim();
      const email = contact.email?.trim();
      if (!person && !email) return <span style={{ color: "var(--cc-text-muted)" }}>—</span>;
      return (
        <>
          <span className="cc-dt-truncate" title={person || email}>
            {person || email}
          </span>
          {person && email ? (
            <span className="cc-dt-sub cc-dt-truncate" title={email}>
              {email}
            </span>
          ) : null}
        </>
      );
    },
  },
  {
    key: "campaigns",
    header: "Campaigns",
    width: CLIENTS_WIDTHS.campaigns,
    align: "right",
    render: (c) => formatFull(c._count.campaigns),
  },
];

export default function ClientsClient({ clients, stats }: {
  clients: Client[];
  stats: { total: number; totalCampaigns: number };
}) {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const filtered = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  const noun = (n: number) => `${formatFull(n)} client${n === 1 ? "" : "s"}`;

  return (
    <div className="rsp-page cc-listpage">
      <PageHeader
        title="Clients"
        subtitle={
          q
            ? `Manage your client relationships and billing · ${formatFull(filtered.length)} of ${noun(clients.length)}`
            : `Manage your client relationships and billing · ${noun(clients.length)}`
        }
        actions={
          <Button variant="primary" iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setShowModal(true)} {...action("new-client")}>
            New client
          </Button>
        }
      />

      <div className="cc-tiles-balanced cc-listpage-tiles" style={{ marginBottom: 24 }}>
        <MetricTile metric="clientsTotal" value={formatFull(stats.total)} />
        {/* Org-wide, not "campaigns belonging to these clients": the count includes
            campaigns with no client assigned, so it does not add up from the rows. */}
        <MetricTile
          metric="campaigns"
          label="Campaigns org-wide"
          value={formatFull(stats.totalCampaigns)}
          footer="Across every client, including campaigns with none assigned"
        />
      </div>

      {/* Search waits for something to search: one client is not a list. */}
      {clients.length > 0 ? (
        <ListToolbar search={{ value: search, onChange: setSearch, placeholder: "Search clients" }} />
      ) : null}

      <DataTable
        caption="Clients"
        columns={COLUMNS}
        rows={filtered}
        rowKey={(c) => c.id}
        rowHref={(c) => `/clients/${c.id}`}
        empty={
          /* A filtered miss is not an empty account. Telling somebody with 40
             clients to "add your first client" because their search matched
             none of them offers the one action that will not help. */
          q ? (
            <NoResults
              title="No clients match that search"
              description={`None of your ${noun(clients.length)} match “${search.trim()}”.`}
              onClear={() => setSearch("")}
              clearLabel="Clear search"
            />
          ) : (
            <EmptyState
              icon={<Building2 size={32} color="var(--cc-text-subtle)" />}
              title="No clients yet"
              description="Add your first client to start managing campaigns."
              action={
                <Button variant="primary" iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setShowModal(true)}>
                  New client
                </Button>
              }
            />
          )
        }
      />

      {showModal && <AddClientModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
