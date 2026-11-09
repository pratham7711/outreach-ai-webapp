"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Target, Sun, Zap, CheckCircle2, XCircle, LayoutList, Folder, Share2, ArrowUpDown, Trash2, Check, ChevronDown, X } from "lucide-react";
import { Avatar } from "@pratham7711/ui";
import {
  PageHeader, StatusTabs, Pagination, FilterDrawer, FilterButton, ActiveFilterChips, Dropdown, MoreMenu, MenuButton, useConfirm, Button,
  DataTable, ListToolbar, NoResults, StatusBadge, statusTone,
} from "@/components/ds";
import type { DataTableColumn, FilterDef, FilterValues } from "@/components/ds";
import CampaignWizard from "@/components/modals/CampaignWizard";
import { timeAgo, formatFullCurrency, formatFull, formatCompactCount, formatDateAbs } from "@/lib/format";
import { useListQuery } from "@/lib/useListQuery";
import { CAMPAIGNS_PAGE_SIZE } from "@/lib/listPageSize";
import { imgSrc } from "@/lib/postMedia";
import FoldersPanel, { type FolderOption } from "./FoldersPanel";
import { ShareModal } from "./ShareModal";
import { CAMPAIGN_STATUS_ALL, UNFILED, isDefaultCampaignSort, type CampaignSort, type CampaignSortKey } from "@/lib/listParams";
import { CAMPAIGN_STATUS_STYLE } from "@/lib/statusColors";
import { CAMPAIGN_STATUS_OPTIONS, campaignStatusText } from "@/components/campaigns/campaignStatus";
import { rememberCampaignList } from "@/lib/campaigns/listReturn";
import { action } from "@/lib/ui/actions";
import { countDelta } from "@/lib/analytics/periodGrowth";
import { Sparkline } from "@/components/ds/Sparkline";
import { prefetchStartFromSources } from "@/components/campaigns/templates/useStartFromSources";

type Campaign = {
  id: string;
  title: string;
  status: string;
  currency: string;
  client?: { name: string } | null;
  thumbnailUrl?: string | null;
  _count: { activations: number; posts: number };
  creatorCount: number;
  /** Summed views over the live posts; null when none was read. */
  views?: number | null;
  /** Live posts with no view figure yet, so not in `views`. */
  viewsUnread?: number;
  /** Views gained this week and last, and the daily line; null with no readings. */
  trend?: { series: number[]; last7: number; prev7: number } | null;
  /** The launch date while it is still ahead, ISO; null once open. */
  opensAt?: string | null;
  /** The newest live post's date, ISO. */
  lastPostAt?: string | null;
  updatedAt?: string;
  budget: number | null;
  team: { id: string; name: string; avatarUrl: string | null }[];
  tags: string[];
  folderId: string | null;
  statusDefId: string | null;
  statusDefName: string | null;
};

/** Views gained in the last 7 days, the change on the 7 before, and the 14-day line. */
function WeekTrend({ trend }: { trend: Campaign["trend"] }) {
  if (!trend) return <span className="cc-dt-sub">No readings yet</span>;
  const delta = countDelta(trend.last7, trend.prev7, "");
  const tone = !delta || delta.trend === "flat" ? "flat" : delta.trend === "up" ? "good" : "bad";
  return (
    <span className="cc-week-trend" data-tone={tone}>
      <Sparkline values={trend.series} width={64} height={24} />
      <span className="cc-week-trend-figures">
        <span title={`${formatFull(trend.last7)} views gained in the last 7 days`}>+{formatCompactCount(trend.last7)}</span>
        {delta ? (
          <span className="cc-metric-delta" data-tone={tone} title="Against the 7 days before">
            {delta.value}
          </span>
        ) : null}
      </span>
    </span>
  );
}

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

/** What an empty status tab is for, when nothing else is narrowing the list. */
const EMPTY_TAB_HINT: Record<string, string> = {
  PENDING: "Campaigns waiting to start will show up here.",
  IN_PROGRESS: "Campaigns that are running will show up here.",
  COMPLETE: "Campaigns you finish will show up here.",
  CANCELLED: "Campaigns you cancel or pause will show up here.",
};

/* DRAFT is deliberately absent: it has no tab of its own and no org status def
   points at it, so a campaign left there was unreachable and unnamed. Campaigns
   now open Active instead — see lib/campaigns/statusDefaults.ts. */
/** One of the org's named statuses from Settings → General. */
type StatusDef = { id: string; name: string; bucket: string };

/**
 * Files a campaign from the row it is on. The column is left out entirely when
 * the org has no folders -- a picker whose only option is "Unfiled" is not a
 * choice.
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
    <span className="cc-campaign-cellstack">
      <Dropdown
        ariaLabel="Campaign folder"
        value={value}
        disabled={saving}
        onChange={change}
        align="left"
        minWidth={120}
        maxWidth={150}
        options={[{ value: "", label: "Unfiled" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
      />
      {error && (
        <span className="cc-campaign-cell-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** "IG Football (Sep)" → "IF". The library's Avatar took the first and last
 *  words, so a bracketed month came out as "I(". */
function campaignInitials(title: string): string {
  const wordsOf = (s: string) => s.replace(/['’]/g, "").match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const unbracketed = wordsOf(title.replace(/\([^)]*\)|\[[^\]]*\]/g, " "));
  const [first, second] = unbracketed.length > 0 ? unbracketed : wordsOf(title);
  if (!first) return "?";
  if (!second) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + second.charAt(0)).toUpperCase();
}

function CampaignThumb({ title, src, size = 44 }: { title: string; src?: string | null; size?: number }) {
  // Initials were only used when there was no URL at all. An image that had a
  // URL but failed to load -- a dead CDN link, an undecodable HEIC, a host the
  // proxy refuses -- left an empty bordered square where the artwork should be,
  // which reads as a broken page rather than a campaign without a picture.
  const [broken, setBroken] = useState(false);
  const url = imgSrc(src, size * 2); // doubled for retina
  // The fallback takes the cover's frame. It used to be the library's 40px
  // round Avatar beside 56px square covers, so titles in one list started at
  // two different x positions.
  if (!url || broken) {
    return (
      <span className="cc-campaign-thumb cc-campaign-thumb-initials" style={{ width: size, height: size }} aria-hidden>
        {campaignInitials(title)}
      </span>
    );
  }
  return (
    <span className="cc-campaign-thumb" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        onError={() => setBroken(true)}
        /* A fetch that fails before hydration fires its error event before
           React has attached onError, and the glyph stayed for good. The ref
           runs on attach, so it sees a failure that already happened. */
        ref={(img) => {
          if (img?.complete && img.naturalWidth === 0) setBroken(true);
        }}
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

/*
 * The row's status: the badge itself opens the menu of statuses.
 *
 * It was a solid primary select on every row, so a page of campaigns carried
 * four or more black slabs beside the one real primary, New campaign (white
 * slabs under Dark). Status reads as a badge in a table; the chevron and the
 * hover say it can be changed.
 */
function StatusSelect({
  id,
  title,
  status,
  statusDefId,
  statusDefs,
}: {
  id: string;
  title: string;
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
        // "No status" is no longer offered, so `next` is always one of the org's
        // own statuses. Both go in one request: the bucket is what the tabs and
        // reports count, so a named status arriving without its bucket would
        // file the campaign under the group it used to be in.
        if (!def) return;
        await patchCampaign(id, { statusDefId: def.id, status: def.bucket });
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
    ? statusDefs.map((d) => ({ value: d.id, label: d.name, bucket: d.bucket }))
    : CAMPAIGN_STATUS_OPTIONS.map((o) => ({ ...o, bucket: o.value }));

  /* A campaign created before the org named its statuses (or whose named status
     was since deleted) has a bucket and no matching def, and read "Set status"
     -- on a campaign the status tabs count as Active. Until a named status is
     picked it shows the bucket's own name, coloured as a status. */
  const current = options.find((o) => o.value === value);
  const text = current?.label ?? (status ? campaignStatusText(status) : "Set status");
  const tone = current ? statusTone(current.bucket) : status ? statusTone(status) : "neutral";

  return (
    <span className="cc-campaign-cellstack">
      <MenuButton
        label={`Status of ${title}: ${text}. Change status`}
        triggerClassName="cc-menu-button cc-row-status"
        portal
        trigger={
          <>
            <StatusBadge tone={tone}>{text}</StatusBadge>
            <ChevronDown size={14} aria-hidden="true" className="cc-row-status-chevron" />
          </>
        }
        items={options.map((o) => ({
          label: o.label,
          icon: <Check size={16} style={{ opacity: o.value === value ? 1 : 0 }} />,
          disabled: saving,
          onClick: () => {
            if (o.value !== value) void change(o.value);
          },
        }))}
      />
      {error && (
        <span role="alert" className="cc-campaign-cell-error">
          {error}
        </span>
      )}
    </span>
  );
}

/*
 * The row's ⋯: Share and Delete.
 *
 * Share stays one click from the list -- the reference puts it on the row, which
 * is the difference between sending a client a report and remembering which
 * tab the button was on -- but inside the menu rather than as a button, so a
 * page of cards carries one status select and one ⋯ each instead of a status
 * select, a Share button and a red bin on every row. It opens the same dialog
 * as the Performance tab, because a second, thinner share control is the one
 * that would forget that an empty platform list means "no restriction".
 *
 * Delete sits last, under a rule. The route soft-deletes and writes an audit
 * entry, so the confirm is about intent rather than loss; it is offered only
 * when the role carries campaigns:delete -- MEMBER and VIEWER do not, and an
 * item that always 403s is worse than none.
 */
function CampaignRowMenu({ id, title, canDelete }: { id: string; title: string; canDelete: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    /* The shared delete wording, except the body: the route soft-deletes, so
       the default "This can't be undone." would be untrue here. */
    const ok = await confirm({
      verb: "delete",
      subject: title,
      description:
        "The campaign stops appearing in lists and reports. Its posts, creators and share links are kept, so an admin can restore it.",
      confirmLabel: "Delete campaign",
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
    <span className="cc-campaign-cellstack" data-align="end">
      <MoreMenu
        size="inline"
        label={`More actions for ${title}`}
        items={[
          { label: "Share campaign", icon: <Share2 size={16} />, onClick: () => setSharing(true) },
          ...(canDelete
            ? [{ label: busy ? "Deleting…" : "Delete campaign", icon: <Trash2 size={16} />, onClick: () => void remove(), disabled: busy, danger: true }]
            : []),
        ]}
      />
      {error && (
        <span role="alert" className="cc-campaign-cell-error">
          {error}
        </span>
      )}
      {sharing && <ShareModal campaignId={id} campaignTitle={title} onClose={() => setSharing(false)} />}
    </span>
  );
}

/*
 * Sort, as the reference offers it: a field and a direction. Not the column
 * headers, because the server sorts by two dates that are not columns.
 *
 * The reference labels the control "Creation Date" and then opens Title and
 * Last Updated inside it; the label is followed rather than the options, since
 * the options are what it actually does.
 */
const SORT_FIELDS: { key: CampaignSortKey; label: string }[] = [
  // The default leads, so the option the list actually opens on is the first
  // thing read in the menu.
  { key: "created", label: "Created" },
  { key: "updated", label: "Last updated" },
];

function SortControl({
  sort,
  onChange,
}: {
  sort: CampaignSort;
  onChange: (next: CampaignSort) => void;
}) {
  return (
    <span className="cc-campaign-sort">
      <ArrowUpDown size={16} aria-hidden="true" />
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

/*
 * The list's columns. It was a stack of bordered cards, each holding four
 * bordered stat chips whose x and width followed their content, so Budget
 * started at x=748 on one row and x=753 on the next. As a table the figures
 * sit in fixed, right-aligned columns that line up down the page.
 *
 * Budget and Team are columns only when a campaign on the page has one: budget
 * is optional and unset on most campaigns, and nothing assigns team members
 * yet, so either would otherwise be a column of dashes.
 */
function campaignColumns({
  folders,
  statusDefs,
  canDelete,
  showBudget,
  showTeam,
}: {
  folders: FolderOption[];
  statusDefs: StatusDef[];
  canDelete: boolean;
  showBudget: boolean;
  showTeam: boolean;
}): DataTableColumn<Campaign>[] {
  return [
    {
      key: "campaign",
      header: "Campaign",
      primary: true,
      minWidth: 220,
      render: (c) => (
        <span className="cc-campaign-cell">
          <CampaignThumb title={c.title} src={c.thumbnailUrl} size={40} />
          <span className="cc-campaign-cell-text">
            <span className="cc-campaign-title" title={c.title}>{c.title}</span>
            <span className="cc-dt-sub cc-dt-truncate">
              {c.lastPostAt ? `Last post ${timeAgo(c.lastPostAt)}` : `Last updated ${timeAgo(c.updatedAt)}`}
              {c.client ? ` · ${c.client.name}` : ""}
            </span>
            {(c.opensAt || c.tags.length > 0) && (
              <span className="cc-campaign-tags">
                {/* Scheduled: off Explore and refusing posts until this day
                    (lib/campaigns/rules), the same state the rules card names. */}
                {c.opensAt && <StatusBadge tone="warning">Opens {formatDateAbs(c.opensAt)}</StatusBadge>}
                {c.tags.map((tag) => (
                  <StatusBadge key={tag} tone="neutral">{tag}</StatusBadge>
                ))}
              </span>
            )}
          </span>
        </span>
      ),
    },
    ...(showBudget
      ? [{
          key: "budget",
          header: "Budget",
          align: "right" as const,
          width: 120,
          render: (c: Campaign) => (c.budget === null ? "—" : formatFullCurrency(c.budget, c.currency)),
        }]
      : []),
    { key: "creators", header: "Creators", align: "right", width: 96, render: (c) => formatFull(c.creatorCount) },
    { key: "posts", header: "Posts", align: "right", width: 80, render: (c) => formatFull(c._count.posts) },
    {
      key: "views",
      header: "Views",
      align: "right",
      phone: true,
      width: 128,
      render: (c) =>
        c.views == null ? (
          <span title="No view count read yet">{"—"}</span>
        ) : (
          <>
            <span title={formatFull(c.views)}>{formatCompactCount(c.views)}</span>
            {c.viewsUnread ? <span className="cc-dt-sub">{formatFull(c.viewsUnread)} not read</span> : null}
          </>
        ),
    },
    {
      key: "week",
      header: "Last 7 days",
      width: 184,
      render: (c) => <WeekTrend trend={c.trend ?? null} />,
    },
    ...(showTeam
      ? [{
          key: "team",
          header: "Team",
          width: 112,
          render: (c: Campaign) =>
            c.team.length === 0 ? (
              "—"
            ) : (
              <span className="cc-campaign-team">
                {c.team.slice(0, 3).map((member) => (
                  <span key={member.id} title={member.name}>
                    <Avatar name={member.name} src={member.avatarUrl ?? undefined} size="sm" />
                  </span>
                ))}
                {c.team.length > 3 && <span className="cc-campaign-team-more">+{c.team.length - 3}</span>}
              </span>
            ),
        }]
      : []),
    ...(folders.length > 0
      ? [{
          key: "folder",
          header: "Folder",
          width: 168,
          render: (c: Campaign) => <FolderSelect id={c.id} folderId={c.folderId} folders={folders} />,
        }]
      : []),
    {
      key: "status",
      header: "Status",
      width: 160,
      render: (c) => (
        <StatusSelect id={c.id} title={c.title} status={c.status} statusDefId={c.statusDefId} statusDefs={statusDefs} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      align: "right",
      width: 64,
      render: (c) => <CampaignRowMenu id={c.id} title={c.title} canDelete={canDelete} />,
    },
  ];
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
  defaultCurrency,
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
  /** Organization.currency, so a new campaign starts in the money the org bills in. */
  defaultCurrency: string;
}) {
  const [search, setSearch] = useState(q);
  const [showModal, setShowModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  // Defaults are passed as undefined so they stay out of the URL entirely —
  // /campaigns rather than /campaigns?page=1. The drawer's values ride along so
  // changing a tab or page keeps the filters applied.
  //
  // status is the exception and is always written: a bare /campaigns now means
  // Active, so All has to say so in the URL or it would be one click away from
  // the sidebar and unreachable on the way back.
  const defaultSort = isDefaultCampaignSort(sort);
  const { push, pending, shown } = useListQuery({
    q,
    status,
    page: page === 1 ? undefined : page,
    folderId,
    sort: defaultSort ? undefined : sort.key,
    dir: defaultSort ? undefined : sort.dir,
    ...filterValues,
  });

  /* The URL this list is showing, for the campaign page's Close and All
     campaigns links (lib/campaigns/listReturn). Read after the props change,
     which is after the router has moved the address bar. */
  const listKey = `${q}|${status}|${page}|${folderId ?? ""}|${sort.key}|${sort.dir}|${JSON.stringify(filterValues)}`;
  useEffect(() => {
    rememberCampaignList(`${window.location.pathname}${window.location.search}`);
  }, [listKey]);

  /* Back to page 1 on every re-sort. Staying on page 7 of a freshly reordered
     list shows a slice of rows nobody asked for, and the top of the new order —
     the whole point of sorting — would be behind six pages. */
  const changeSort = (next: CampaignSort) =>
    push({ sort: next.key, dir: next.dir, page: null });

  /* The tabs, sort and pager draw from `shown` -- the query with the click
     already applied (see useListQuery) -- so a choice shows the moment it is
     made, not when the server answers. A value cleared to null falls back to
     the server's, which is what they showed before. */
  const shownStatus = typeof shown.status === "string" ? shown.status : status;
  const shownSort: CampaignSort =
    typeof shown.sort === "string"
      ? { key: shown.sort as CampaignSortKey, dir: shown.dir === "asc" ? "asc" : "desc" }
      : sort;
  const shownPage = shown.page === null ? 1 : Number(shown.page ?? page);

  const selectedFolder = folderId && folderId !== UNFILED ? folders.find((f) => f.id === folderId) : undefined;
  const folderLabel = folderId === UNFILED ? "Unfiled" : selectedFolder?.name;

  const FILTERS: FilterDef[] = [
    // Clients are added on the Clients page, which is parked, so for most orgs
    // this list is empty and the filter could only ever open onto nothing.
    ...(clients.length
      ? [{
          type: "multiSelect" as const,
          key: "clientIds",
          label: "Client",
          options: clients.map((c) => ({ value: c.id, label: c.name })),
        }]
      : []),
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

  /* Chooses the empty state's wording, so it has to mean "is this page empty
     because something is narrowing it". Any tab other than All narrows --
     Active, which the page now opens on, included.

     Gated on the org having campaigns at all, because that default made the two
     cases collide: a brand-new org lands on Active with nothing anywhere, and
     "No campaigns match those filters" would be answering a question nobody
     asked. Nothing is filtered away when there is nothing. */
  /* The status counts are narrowed by the drawer's filters, so a filter that
     matched nothing read as an org with no campaigns: "No campaigns yet",
     with the tabs, search and Filters button that could undo it hidden.
     Filed plus unfiled is every campaign the org has, whatever is applied. */
  const orgHasCampaigns = unfiledCount + folders.reduce((n, f) => n + f.campaigns, 0) > 0;
  const anyFilter =
    orgHasCampaigns &&
    (Boolean(q) || status !== CAMPAIGN_STATUS_ALL || filterCount > 0 || Boolean(folderId));
  /* Only the status tab narrows: nothing was typed or filtered, so "No
     campaigns match those filters" and a Clear filters button answered a
     question nobody asked. Say the tab is empty instead. */
  const onlyTabNarrows =
    orgHasCampaigns && !q && filterCount === 0 && !folderId && status !== CAMPAIGN_STATUS_ALL;
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

  const totalPages = Math.max(1, Math.ceil(filteredTotal / CAMPAIGNS_PAGE_SIZE));
  const hasAny = orgHasCampaigns;

  const columns = useMemo(
    () =>
      campaignColumns({
        folders,
        statusDefs,
        canDelete,
        showBudget: campaigns.some((c) => c.budget !== null),
        showTeam: campaigns.some((c) => c.team.length > 0),
      }),
    [folders, statusDefs, canDelete, campaigns],
  );

  const tabLabel = (STATUS_TABS.find((t) => t.key === status)?.label ?? "").toLowerCase();
  const empty = !hasAny ? (
    <NoResults
      icon={<Target size={32} strokeWidth={1.75} />}
      title="No campaigns yet"
      description="Create your first campaign to get started."
    />
  ) : onlyTabNarrows ? (
    <NoResults
      icon={<Target size={32} strokeWidth={1.75} />}
      title={`No ${tabLabel} campaigns`}
      description={EMPTY_TAB_HINT[status] ?? "Campaigns with this status will show up here."}
      onClear={() => push({ status: CAMPAIGN_STATUS_ALL, page: null })}
      clearLabel="View all campaigns"
    />
  ) : (
    <NoResults
      title={anyFilter ? "No campaigns match" : "No campaigns"}
      description="Nothing matches this search, status and these filters."
      onClear={clearEverything}
    />
  );

  return (
    <div className="cc-page-content rsp-page cc-campaigns-page">
      <PageHeader
        title="Campaigns"
        /* The status tabs close the header band, so the page reads header,
           tabs, toolbar, list. Hidden while the org has no campaigns at all:
           five tabs reading All 0 / Pending 0 / Active 0 / Complete 0 /
           Canceled 0 above "No campaigns yet" is a status breakdown of
           nothing, and this is the page sign-in lands on. statusCounts is the
           unfiltered tab base, so this asks "any campaigns", not "any
           matches". Each tab's count is the number the caption used to say. */
        tabs={
          hasAny ? (
            <StatusTabs
              ariaLabel="Filter by campaign status"
              tabs={STATUS_TABS.map(({ Icon, ...tab }) => ({
                ...tab,
                count: statusCounts[tab.key] ?? 0,
                icon: <Icon size={14} aria-hidden="true" />,
              }))}
              active={shownStatus}
              onChange={(key) => push({ status: key, page: null })}
            />
          ) : undefined
        }
        actions={
          <>
          <Button
            variant="secondary"
            iconLeft={<Folder size={16} />}
            size="sm"
            onClick={() => setShowFolders(true)}
          >
            Folders{folders.length > 0 ? ` (${folders.length})` : ""}
          </Button>
          <Button variant="primary" iconLeft={<Plus size={16} />} size="sm" onPointerEnter={prefetchStartFromSources} onFocus={prefetchStartFromSources} onClick={() => setShowModal(true)} {...action("new-campaign")}>
            New campaign
          </Button>
          </>
        }
      />

      {/* One row: search on the left; the folder being shown, sort and
          Filters on the right. It was two rows -- search alone, then sort and
          filters under it -- copied from the reference's layout, which put
          48px between the header and the list for no control. Left out while
          the org has no campaigns: there is nothing to search. */}
      {hasAny && (
        <ListToolbar
          search={{ value: search, onChange: setSearch, placeholder: "Search campaigns" }}
          end={
            <>
              {folderLabel && (
                <span className="cc-campaign-folder-chip">
                  <Folder size={14} aria-hidden="true" />
                  {folderLabel}
                  <button
                    type="button"
                    aria-label="Clear folder filter"
                    onClick={() => push({ folderId: null, page: null })}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              )}
              <SortControl sort={shownSort} onChange={changeSort} />
              <FilterButton count={filterCount} onClick={() => setShowFilters(true)} />
            </>
          }
        />
      )}

      <ActiveFilterChips filters={FILTERS} values={filterValues} onClear={(keys) => push({ ...Object.fromEntries(keys.map((k) => [k, null])), page: null })} />

      <DataTable
        className="cc-campaigns-table"
        caption="Campaigns"
        columns={columns}
        rows={campaigns}
        rowKey={(c) => c.id}
        rowHref={(c) => `/campaigns/${c.id}`}
        loading={pending}
        skeletonRows={Math.min(CAMPAIGNS_PAGE_SIZE, 8)}
        empty={empty}
        footer={
          campaigns.length > 0 ? (
            <Pagination
              page={shownPage}
              totalPages={totalPages}
              total={filteredTotal}
              pageSize={CAMPAIGNS_PAGE_SIZE}
              loading={pending}
              onPageChange={(p) => push({ page: p === 1 ? null : p })}
            />
          ) : undefined
        }
      />

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

      {showModal && (
        <CampaignWizard
          clients={clients}
          defaultCurrency={defaultCurrency}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
