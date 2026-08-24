"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Target, Sun, Zap, CheckCircle2, XCircle, Wallet, Users, FileText, LayoutList, Folder, Share2, ArrowUpDown, Trash2 } from "lucide-react";
import Link from "next/link";
import { Card, Badge, Input, EmptyState, Avatar } from "@pratham7711/ui";
import { StatusTabs, Pagination, FilterDrawer, FilterButton, Dropdown, useConfirm, Button } from "@/components/ds";
import type { FilterDef, FilterValues } from "@/components/ds";
import CampaignWizard from "@/components/modals/CampaignWizard";
import { formatCompactCurrency, timeAgo } from "@/lib/format";
import { useListQuery } from "@/lib/useListQuery";
import { CAMPAIGNS_PAGE_SIZE } from "@/lib/listPageSize";
import { imgSrc } from "@/lib/postMedia";
import FoldersPanel, { type FolderOption } from "./FoldersPanel";
import { ShareModal } from "./ShareModal";
import { UNFILED, isDefaultCampaignSort, type CampaignSort, type CampaignSortKey } from "@/lib/listParams";
import { CAMPAIGN_STATUS_STYLE } from "@/lib/statusColors";

type Campaign = {
  id: string;
  title: string;
  status: string;
  currency: string;
  client?: { name: string } | null;
  thumbnailUrl?: string | null;
  _count: { activations: number; posts: number };
  creatorCount: number;
  updatedAt?: string;
  budget: number | null;
  team: { id: string; name: string; avatarUrl: string | null }[];
  tags: string[];
  folderId: string | null;
  statusDefId: string | null;
  statusDefName: string | null;
};

type Client = { id: string; name: string };
type TeamOption = { id: string; name: string };

const CAMPAIGN_TYPE_OPTIONS = [
  { value: "BUDGET_BASED", label: "Budget Based" },
  { value: "VIEW_BASED", label: "View Based" },
  { value: "OPEN_COMMUNITY", label: "Open Community" },
  { value: "PRIVATE_INVITE", label: "Private Invite" },
];

const STATUS_TABS = [
  { key: "ALL",         label: "All",       ...CAMPAIGN_STATUS_STYLE.ALL,         Icon: LayoutList },
  { key: "PENDING",     label: "Pending",   ...CAMPAIGN_STATUS_STYLE.PENDING,     Icon: Sun },
  { key: "IN_PROGRESS", label: "Active",    ...CAMPAIGN_STATUS_STYLE.IN_PROGRESS, Icon: Zap },
  { key: "COMPLETE",    label: "Complete",  ...CAMPAIGN_STATUS_STYLE.COMPLETE,    Icon: CheckCircle2 },
  { key: "CANCELLED",   label: "Canceled",  ...CAMPAIGN_STATUS_STYLE.CANCELLED,   Icon: XCircle },
];

/* The dropdown offers every status, including DRAFT, which has no tab of its
   own — a campaign can be in it, so it has to be reachable and displayable. */
/** One of the org's named statuses from Settings → General. */
type StatusDef = { id: string; name: string; bucket: string };

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In-Progress" },
  { value: "COMPLETE", label: "Complete" },
  { value: "CANCELLED", label: "Canceled" },
];

const STATUS_BADGE_VARIANT: Record<string, "warning" | "accent" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  IN_PROGRESS: "accent",
  COMPLETE: "success",
  CANCELLED: "danger",
  DRAFT: "neutral",
};

/**
 * 506 of 532 campaigns carry artwork that this list was throwing away in favour
 * of two initials. Falls back to the initials avatar only when there is genuinely
 * no image, so a missing thumbnail still reads as a campaign rather than a hole.
 */
/**
 * Files a campaign from the row it is on. Deliberately quieter than the status
 * dropdown next to it: filing is bookkeeping, and it should not compete with
 * the campaign's state for attention. Hidden entirely when the org has no
 * folders — a picker whose only option is "Unfiled" is not a choice.
 */
function FolderSelect({
  id,
  folderId,
  folders,
}: {
  id: string;
  folderId: string | null;
  folders: FolderOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(folderId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValue(folderId ?? ""), [folderId]);

  if (folders.length === 0) return null;

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      // "" is the unfiled option, and null is how the API clears the column.
      await patchCampaign(id, { folderId: next === "" ? null : next });
      router.refresh();
    } catch (e) {
      setValue(previous);
      setError(e instanceof Error ? e.message : "Could not move campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <Dropdown
        ariaLabel="Campaign folder"
        value={value}
        disabled={saving}
        onChange={change}
        minWidth={120}
        maxWidth={150}
        options={[{ value: "", label: "Unfiled" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
      />
      {error && (
        <span style={{ fontSize: 11, color: "#DC2626", maxWidth: 160, textAlign: "right" }} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function CampaignThumb({ title, src, size = 44 }: { title: string; src?: string | null; size?: number }) {
  // Initials were only used when there was no URL at all. An image that had a
  // URL but failed to load -- a dead CDN link, an undecodable HEIC, a host the
  // proxy refuses -- left an empty bordered square where the artwork should be,
  // which reads as a broken page rather than a campaign without a picture.
  const [broken, setBroken] = useState(false);
  const url = imgSrc(src, size * 2); // doubled for retina
  if (!url || broken) return <Avatar name={title} size="md" />;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        flexShrink: 0,
        overflow: "hidden",
        display: "block",
        border: "1px solid var(--cc-border)",
        background: "var(--cc-hover-bg)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        onError={() => setBroken(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </span>
  );
}

/**
 * The per-card status dropdown. PATCH /api/campaigns/[id] already accepted a
 * status, so this adds no route.
 *
 * The select shows the pending value while the request is in flight and snaps
 * back to the server's value on failure, so the card never settles on a status
 * the database refused. The error sits next to the control rather than in a
 * toast, because the control is what the reader needs to retry.
 */
async function patchCampaign(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/campaigns/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? `Update failed (${res.status})`);
  }
}

function StatusSelect({
  id,
  status,
  statusDefId,
  statusDefs,
}: {
  id: string;
  status: string;
  statusDefId: string | null;
  statusDefs: StatusDef[];
}) {
  const router = useRouter();
  // A named status is chosen by its own id; the bucket travels with it. When the
  // org has defined none, this falls back to the buckets themselves, which is
  // what every campaign predating Settings → General still uses.
  const useDefs = statusDefs.length > 0;
  const [value, setValue] = useState(useDefs ? statusDefId ?? "" : status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A refresh (this card's own save, or another's) re-renders with new props;
  // local state has to follow or the select would show a stale status.
  useEffect(() => setValue(useDefs ? statusDefId ?? "" : status), [status, statusDefId, useDefs]);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      if (useDefs) {
        const def = statusDefs.find((d) => d.id === next);
        // Both go in one request: the bucket is what the tabs and reports count,
        // so a named status arriving without its bucket would file the campaign
        // under the group it used to be in.
        await patchCampaign(id, def ? { statusDefId: def.id, status: def.bucket } : { statusDefId: null });
      } else {
        await patchCampaign(id, { status: next });
      }
      router.refresh();
    } catch (e) {
      setValue(previous);
      setError(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setSaving(false);
    }
  }

  const options = useDefs
    ? [
        { value: "", label: "No status" },
        ...statusDefs.map((d) => ({ value: d.id, label: d.name })),
      ]
    : STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <Dropdown
        ariaLabel="Campaign status"
        value={value}
        disabled={saving}
        onChange={change}
        variant="primary"
        minWidth={150}
        placeholder="No status"
        options={options}
      />
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--cc-danger)", maxWidth: 180, textAlign: "right" }}>
          {error}
        </span>
      )}
    </span>
  );
}

/** One bordered stat on a campaign card. */
/*
 * Share, on the row. The reference puts it here rather than only inside a
 * campaign, which is the difference between sending a client a report and
 * remembering which tab the button was on.
 *
 * It opens the same dialog as the Performance tab -- create, copy, per-field
 * visibility, revoke -- because a second, thinner share control on the busier
 * surface is the one that would forget that an empty platform list means "no
 * restriction" rather than "nothing".
 */
function ShareButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Share ${title}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "var(--cc-card)",
          color: "var(--cc-primary)",
          border: "1.5px solid var(--cc-primary)",
          borderRadius: 8,
          padding: "7px 12px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <Share2 size={14} aria-hidden="true" />
        Share
      </button>
      {open && <ShareModal campaignId={id} campaignTitle={title} onClose={() => setOpen(false)} />}
    </>
  );
}

/*
 * Delete, the second half of the reference's row menu.
 *
 * The reference hides Add to Folder and Delete behind a kebab. Folder and
 * status are already inline controls on this row, so only Delete was missing,
 * and it goes inline beside them rather than reinstating a menu to hold one
 * item.
 *
 * The route soft-deletes and writes an audit entry, so this is recoverable and
 * the confirm is about intent rather than about loss. It is only rendered when
 * the role actually carries campaigns:delete -- MEMBER and VIEWER do not, and a
 * button that always 403s is worse than no button.
 */
function DeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const ok = await confirm({
      title: `Delete ${title}?`,
      description:
        "The campaign stops appearing in lists and reports. Its posts, creators and share links are kept, so this can be undone by an admin.",
      confirmLabel: "Delete campaign",
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Delete failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete campaign");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        title={`Delete ${title}`}
        aria-label={`Delete ${title}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--cc-card)",
          color: "var(--cc-danger)",
          border: "1.5px solid var(--cc-danger)",
          borderRadius: 8,
          padding: 8,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--cc-danger)", maxWidth: 180, textAlign: "right" }}>
          {error}
        </span>
      )}
    </span>
  );
}

/*
 * Sort, as the reference offers it: a field and a direction, not a column
 * header -- this list is cards, so there is no header row to click.
 *
 * The reference labels the control "Creation Date" and then opens Title and
 * Last Updated inside it; the label is followed rather than the options, since
 * the options are what it actually does.
 */
const SORT_FIELDS: { key: CampaignSortKey; label: string }[] = [
  { key: "updated", label: "Last Updated" },
  { key: "created", label: "Created" },
];

function SortControl({
  sort,
  onChange,
}: {
  sort: CampaignSort;
  onChange: (next: CampaignSort) => void;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <ArrowUpDown size={15} aria-hidden="true" style={{ color: "var(--cc-text-muted)" }} />
      <Dropdown
        ariaLabel="Sort campaigns by"
        value={sort.key}
        onChange={(v) => onChange({ key: v as CampaignSortKey, dir: sort.dir })}
        options={SORT_FIELDS.map((f) => ({ value: f.key, label: f.label }))}
        align="left"
        minWidth={140}
      />
      {/* Both remaining fields are dates, so newest/oldest says it plainly. */}
      <Dropdown
        ariaLabel="Sort direction"
        value={sort.dir}
        onChange={(v) => onChange({ key: sort.key, dir: v as "asc" | "desc" })}
        options={[
          { value: "desc", label: "Newest" },
          { value: "asc", label: "Oldest" },
        ]}
        align="left"
        minWidth={110}
      />
    </span>
  );
}

function StatChip({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid var(--cc-border)",
        borderRadius: 10,
        padding: "6px 10px",
        background: "var(--cc-card)",
        minWidth: 0,
      }}
    >
      <span aria-hidden="true" style={{ display: "flex", color: "var(--cc-text-muted)" }}>{icon}</span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--cc-text-muted)" }}>
          {label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", fontVariantNumeric: "tabular-nums" }}>
          {children}
        </span>
      </span>
    </span>
  );
}

export default function CampaignsClient({
  campaigns,
  stats,
  statusCounts,
  filteredTotal,
  page,
  q,
  status,
  clients,
  tagOptions,
  teamOptions,
  filterValues,
  filterCount,
  folders,
  folderId,
  unfiledCount,
  sort,
  canDelete,
  statusDefs,
}: {
  campaigns: Campaign[];
  stats: { total: number; active: number; creatorCount: number };
  statusCounts: Record<string, number>;
  filteredTotal: number;
  page: number;
  q: string;
  status: string;
  clients: Client[];
  tagOptions: string[];
  teamOptions: TeamOption[];
  filterValues: FilterValues;
  filterCount: number;
  folders: FolderOption[];
  folderId?: string;
  unfiledCount: number;
  sort: CampaignSort;
  canDelete: boolean;
  statusDefs: StatusDef[];
}) {
  const [search, setSearch] = useState(q);
  const [showModal, setShowModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  // Defaults are passed as undefined so they stay out of the URL entirely —
  // /campaigns rather than /campaigns?status=ALL&page=1. The drawer's values
  // ride along so changing a tab or page keeps the filters applied.
  const defaultSort = isDefaultCampaignSort(sort);
  const { push, pending } = useListQuery({
    q,
    status: status === "ALL" ? undefined : status,
    page: page === 1 ? undefined : page,
    folderId,
    sort: defaultSort ? undefined : sort.key,
    dir: defaultSort ? undefined : sort.dir,
    ...filterValues,
  });

  /* Back to page 1 on every re-sort. Staying on page 7 of a freshly reordered
     list shows a slice of rows nobody asked for, and the top of the new order —
     the whole point of sorting — would be behind six pages. */
  const changeSort = (next: CampaignSort) =>
    push({ sort: next.key, dir: next.dir, page: null });

  const selectedFolder = folderId && folderId !== UNFILED ? folders.find((f) => f.id === folderId) : undefined;
  const folderLabel = folderId === UNFILED ? "Unfiled" : selectedFolder?.name;

  const FILTERS: FilterDef[] = [
    {
      type: "multiSelect",
      key: "clientIds",
      label: "Client",
      options: clients.map((c) => ({ value: c.id, label: c.name })),
    },
    { type: "multiSelect", key: "campaignType", label: "Campaign type", options: CAMPAIGN_TYPE_OPTIONS },
    // Both are omitted entirely when nothing has been tagged or assigned. The
    // options come from the join tables, so an always-empty dropdown is not a
    // state this can reach -- either there is something to filter by, or the
    // control is not offered. Nothing in the app writes these rows yet.
    ...(tagOptions.length
      ? [{ type: "multiSelect" as const, key: "tags", label: "Tags", options: tagOptions.map((t) => ({ value: t, label: t })) }]
      : []),
    ...(teamOptions.length
      ? [{
          type: "multiSelect" as const,
          key: "teamMemberIds",
          label: "Team member",
          options: teamOptions.map((u) => ({ value: u.id, label: u.name })),
        }]
      : []),
    { type: "dateRange", label: "Created", fromKey: "createdFrom", toKey: "createdTo" },
    {
      type: "toggleGroup",
      label: "Activity",
      options: [
        { key: "hasCreators", label: "Has creators assigned" },
        { key: "hasPosts", label: "Has posts delivered" },
      ],
    },
  ];

  const anyFilter = Boolean(q) || status !== "ALL" || filterCount > 0 || Boolean(folderId);
  const clearEverything = () => {
    setSearch("");
    const cleared: Record<string, null> = { q: null, status: null, page: null, folderId: null, sort: null, dir: null };
    for (const key of Object.keys(filterValues)) cleared[key] = null;
    push(cleared);
  };

  // Filtering happens in the database now, so the box debounces into the URL
  // instead of slicing a local array.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => push({ q: search || null, page: null }), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirrors CreatorCore: the count under the title reflects the selected status
  // tab ("4 Active Campaigns", "497 Complete Campaigns"), not the overall total.
  // With a search active it reports the match count instead, so the number
  // always describes what is on screen.
  const activeTab = STATUS_TABS.find((t) => t.key === status);
  const tabCount = q ? filteredTotal : statusCounts[status] ?? 0;
  const countLabel =
    status === "ALL"
      ? `${tabCount} Campaign${tabCount !== 1 ? "s" : ""}`
      : `${tabCount} ${activeTab?.label ?? ""} Campaign${tabCount !== 1 ? "s" : ""}`;

  const filtered = campaigns;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / CAMPAIGNS_PAGE_SIZE));

  return (
    <div className="cc-page-content rsp-page">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Campaigns
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            {countLabel}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            variant="secondary"
            iconLeft={<Folder size={15} />}
            size="sm"
            onClick={() => setShowFolders(true)}
          >
            Folders{folders.length > 0 ? ` (${folders.length})` : ""}
          </Button>
          {/* /campaigns/self-serve is a whole second way to create a campaign —
              budget first, shortlist creators, flat platform fee — and nothing
              in the app linked to it, so it could only be reached by typing the
              URL. */}
          <Link
            href="/campaigns/self-serve"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--cc-border)",
              background: "var(--cc-card)",
              color: "var(--cc-text)",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            <Wallet size={15} />
            Self-serve campaign
          </Link>
          <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)}>
            New Campaign
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div style={{ marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Campaigns"
            iconLeft={<Search size={16} />}
          />
        </div>
        <SortControl sort={sort} onChange={changeSort} />
        <FilterButton count={filterCount} onClick={() => setShowFilters(true)} />
      </div>

      {folderLabel && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "color-mix(in srgb, var(--cc-primary) 8%, transparent)",
              border: "1px solid var(--cc-primary)", color: "var(--cc-primary)",
              borderRadius: 999, padding: "5px 12px", fontSize: 13, fontWeight: 600,
            }}
          >
            <Folder size={13} aria-hidden="true" />
            {folderLabel}
            <button
              type="button"
              aria-label="Clear folder filter"
              onClick={() => push({ folderId: null, page: null })}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", lineHeight: 1, fontSize: 15 }}
            >
              ×
            </button>
          </span>
        </div>
      )}

      {/* Status Tabs */}
      <StatusTabs
        ariaLabel="Filter by campaign status"
        style={{ marginBottom: 24 }}
        tabs={STATUS_TABS.map(({ Icon, ...tab }) => ({
          ...tab,
          count: statusCounts[tab.key] ?? 0,
          badgeVariant: STATUS_BADGE_VARIANT[tab.key] ?? "neutral",
          icon: <Icon size={14} aria-hidden="true" />,
        }))}
        active={status}
        onChange={(key) => push({ status: key === "ALL" ? null : key, page: null })}
      />

      {/* Campaign List */}
      {filtered.length === 0 ? (
        <Card variant="solid" noPadding>
          <div style={{ padding: "48px 24px" }}>
            <EmptyState
              icon={<Target size={32} color="var(--cc-text-subtle)" />}
              title={anyFilter ? "No campaigns match those filters" : "No campaigns yet"}
              description={
                anyFilter
                  ? "Try a different search term, status or filter."
                  : "Create your first campaign to get started"
              }
              action={
                anyFilter ? (
                  <Button variant="secondary" onClick={clearEverything}>
                    Clear filters
                  </Button>
                ) : (
                  <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
                    New Campaign
                  </Button>
                )
              }
            />
          </div>
        </Card>
      ) : (
        <div className="cc-stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((campaign) => (
            <div
              key={campaign.id}
              className="cc-table-row"
              style={{
                background: "var(--cc-card)",
                border: "1px solid var(--cc-border)",
                borderRadius: 12,
                padding: 14,
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              {/* Only the identity block navigates. The chips and the status
                  dropdown sit outside the link, because a select nested in an
                  anchor navigates instead of opening. */}
              <Link
                prefetch={false}
                href={`/campaigns/${campaign.id}`}
                style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12, flex: "1 1 240px", minWidth: 0 }}
              >
                <CampaignThumb title={campaign.title} src={campaign.thumbnailUrl} size={56} />
                <span style={{ minWidth: 0 }}>
                  <span
                    title={campaign.title}
                    style={{
                      display: "block",
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--cc-primary)",
                      marginBottom: 3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {campaign.title}
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-subtle)" }}>
                    Last updated {timeAgo(campaign.updatedAt)}
                    {campaign.client ? ` \u00b7 ${campaign.client.name}` : ""}
                  </span>
                  {campaign.tags.length > 0 && (
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                      {campaign.tags.map((tag) => (
                        <Badge key={tag} variant="neutral" size="sm">{tag}</Badge>
                      ))}
                    </span>
                  )}
                </span>
              </Link>

              {/* Budget and Team are dropped when absent rather than shown as a
                  zero or an empty avatar row: budget is nullable and unset on
                  most campaigns, and nothing assigns team members yet. */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {campaign.budget !== null && (
                  <StatChip icon={<Wallet size={15} />} label="Budget">
                    {formatCompactCurrency(campaign.budget, campaign.currency)}
                  </StatChip>
                )}
                <StatChip icon={<Users size={15} />} label="Creators">
                  {campaign.creatorCount}
                </StatChip>
                <StatChip icon={<FileText size={15} />} label="Posts">
                  {campaign._count.posts}
                </StatChip>
                {campaign.team.length > 0 && (
                  <StatChip icon={<Users size={15} />} label="Team">
                    <span style={{ display: "inline-flex", alignItems: "center" }}>
                      {campaign.team.slice(0, 3).map((member, idx) => (
                        <span key={member.id} title={member.name} style={{ marginLeft: idx === 0 ? 0 : -6 }}>
                          <Avatar name={member.name} src={member.avatarUrl ?? undefined} size="sm" />
                        </span>
                      ))}
                      {campaign.team.length > 3 && (
                        <span style={{ marginLeft: 5, fontSize: 12, color: "var(--cc-text-muted)" }}>
                          +{campaign.team.length - 3}
                        </span>
                      )}
                    </span>
                  </StatChip>
                )}
              </div>

              <FolderSelect id={campaign.id} folderId={campaign.folderId} folders={folders} />
              <StatusSelect
                id={campaign.id}
                status={campaign.status}
                statusDefId={campaign.statusDefId}
                statusDefs={statusDefs}
              />
              <ShareButton id={campaign.id} title={campaign.title} />
              {canDelete && <DeleteButton id={campaign.id} title={campaign.title} />}
            </div>
          ))}
        </div>
      )}

      {filteredTotal > CAMPAIGNS_PAGE_SIZE && (
        <Pagination
          style={{ marginTop: 24 }}
          page={page}
          totalPages={totalPages}
          total={filteredTotal}
          pageSize={CAMPAIGNS_PAGE_SIZE}
          loading={pending}
          onPageChange={(p) => push({ page: p === 1 ? null : p })}
        />
      )}

      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        filters={FILTERS}
        values={filterValues}
        onApply={(next) => push({ ...next, page: null })}
      />

      <FoldersPanel
        open={showFolders}
        onClose={() => setShowFolders(false)}
        folders={folders}
        unfiled={unfiledCount}
        // Not stats.total: that one is narrowed by whatever filters are active,
        // including the folder itself, so "All campaigns" would report the
        // selected folder's size. Filed plus unfiled is every campaign, always.
        total={unfiledCount + folders.reduce((n, f) => n + f.campaigns, 0)}
        selected={folderId}
        onSelect={(next) => push({ folderId: next, page: null })}
      />

      {showModal && <CampaignWizard clients={clients} onClose={() => setShowModal(false)} />}
    </div>
  );
}
