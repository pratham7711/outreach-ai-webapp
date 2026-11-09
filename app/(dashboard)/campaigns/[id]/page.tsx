"use client";
import { useState, useEffect, useCallback, useMemo, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import Link from "next/link";
import { Badge, EmptyState, Avatar, Input, Textarea } from "@pratham7711/ui";
import { Modal } from "@/components/ds/Modal";
import { Dropdown, MetricTile, EntityPicker, Button, PageHeader, SectionCard, Field, FieldRow, Skeleton } from "@/components/ds";
import { TileGridSkeleton, PageHeaderSkeleton } from "@/components/ui/PageSkeleton";
import { PlatformSplit } from "@/components/charts/PlatformSplit";
import { useDirty } from "@/lib/useDirty";
import { CAMPAIGN_STATUS_OPTIONS, campaignStatusText } from "@/components/campaigns/campaignStatus";
import { StatusBadge } from "@/components/ds/StatusBadge";
import PostsTab from "./PostsTab";
import ActivityFeed from "./ActivityFeed";
import DraftsTab from "./DraftsTab";
import CreativeBriefCard from "./CreativeBriefCard";
import CampaignRulesCard from "./CampaignRulesCard";
import { viewGoalProgress, type CampaignRules } from "@/lib/campaigns/rulesShape";
import RosterTable, { ROSTER_COLUMNS, ROSTER_DEFAULT_COLUMNS, type RosterRow } from "./RosterTable";
import { readCampaignSection } from "@/lib/campaignSections";
import { SHOW_MONEY } from "@/lib/moneyUi";
import { useCampaignNavPublish } from "@/components/providers/CampaignNavProvider";
import { CampaignPhoneTabs } from "@/components/CampaignPhoneTabs";
import { CampaignAudioSetup } from "@/components/campaigns/CampaignAudioSetup";
import { CampaignSwitchesCard } from "./CampaignSwitchesCard";
import { CampaignPictureCard } from "@/components/campaigns/CampaignPictureCard";
import { CAMPAIGN_HEADER_ACTIONS_ID } from "@/components/campaigns/CampaignHeaderActions";
import { SaveAsTemplateAction } from "@/components/campaigns/templates/SaveAsTemplateAction";
import { CampaignShareButton } from "@/components/campaigns/CampaignShareButton";
import { NotFoundState } from "@/components/errors/NotFoundState";
import { useCampaignListHref } from "@/lib/campaigns/listReturn";
import InvitesSection from "./InvitesSection";
import {
  Eye, Heart, MessageCircle, Share2, TrendingUp, Users,
  Calendar, Play, ExternalLink, DollarSign,
  ClipboardList, Wallet, Trash2, AlertTriangle, UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateAbs, formatFull, formatFullCurrency } from "@/lib/format";
import { asOfCaption } from "@/lib/dataAge";
import { CreatorSelect } from "@/components/CreatorSelect";
import { TOP_CREATOR_BARS, type CampaignPostSummary } from "@/lib/campaigns/detailSummary";
import { loadCharts } from "@/components/charts/lazyCharts";
import { noun } from "@/lib/ui/noun";
import { platformLabel } from "@/lib/format";
import { followersReached } from "@/lib/campaigns/followersReached";

const ChartSkeleton = ({ height }: { height: number }) => (
  <Skeleton width="100%" height={height} radius="var(--cc-r-card)" />
);

const PerformanceTab = dynamic(() => loadCharts().then((m) => m.PerformanceTab), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <TileGridSkeleton count={9} />
      <Skeleton width="100%" height={320} radius="var(--cc-r-card)" />
    </div>
  ),
});

const MarketplaceAnalytics = dynamic(() => loadCharts().then((m) => m.MarketplaceAnalytics), {
  ssr: false,
  loading: () => <ChartSkeleton height={240} />,
});

const CreatorPerformanceBar = dynamic(() => loadCharts().then((m) => m.CreatorPerformanceBar), {
  ssr: false,
  loading: () => <ChartSkeleton height={240} />,
});

/* The sections themselves live in lib/campaignSections, because the left rail
   renders the same list. They used to be a tab strip here; that strip is gone,
   and activeTab below takes its type from that module's reader. */

function formatNumber(num: number): string {
  return formatFull(num);
}

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}


/* The roster and the post totals arrive built by GET /api/campaigns/[id]
   (lib/campaigns/detailSummary), which no longer sends the posts themselves:
   1.26 MB of the largest campaign's 1.28 MB payload was that array, used only
   for the figures that are now computed beside it. */

type Activation = {
  id: string;
  status: string;
  deliverableDueDate: string | null;
  creator: {
    id: string; name: string; handle: string; platform: string;
    followersCount: number; avatarUrl: string | null; rate: number | null;
  };
};

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  BUDGET_BASED: "Budget based",
  VIEW_BASED: "View based",
  OPEN_COMMUNITY: "Open community",
  PRIVATE_INVITE: "Private invite",
};

// ─── Marketplace (Phase 2M) ────────────────────────────────────────────────
const MARKETPLACE_PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"] as const;

const VISIBILITY_OPTIONS: { value: "PRIVATE" | "GLOBAL" | "INVITE_ONLY"; label: string; desc: string }[] = [
  { value: "PRIVATE", label: "Private", desc: "Managed by your team only — not listed anywhere public." },
  { value: "GLOBAL", label: "Public marketplace", desc: "Listed on the public /explore page. Any creator can discover and join." },
  { value: "INVITE_ONLY", label: "Invite only", desc: "Reachable only by creators who have your invite code." },
];

// Amounts are stored as integer MINOR units (cents/paise). UI works in major units.
function minorToMajor(minor: number | null | undefined): string {
  if (minor == null) return "";
  return (minor / 100).toString();
}
function majorToMinor(major: string): number | null {
  const trimmed = major.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

type MarketplaceVisibility = "PRIVATE" | "GLOBAL" | "INVITE_ONLY";
type MarketplacePlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "TWITTER";

type Campaign = {
  id: string;
  title: string;
  status: string;
  campaignType?: string;
  typeConfig?: Record<string, unknown> | null;
  budget: number | null;
  currency: string;
  notes: string | null;
  clientId: string | null;
  client?: { id: string; name: string } | null;
  thumbnailUrl?: string | null;
  songId?: string | null;
  createdAt: string;
  updatedAt: string;
  // Marketplace (Phase 2M)
  marketplaceVisibility?: MarketplaceVisibility;
  publicSlug?: string | null;
  guidelines?: string | null;
  requirements?: string | null;
  contentAssetsUrl?: string | null;
  ratePerThousand?: Partial<Record<MarketplacePlatform, number>> | null;
  minPayoutMinor?: number | null;
  marketplaceBudgetCapMinor?: number | null;
  submissionDeadline?: string | null;
  autoApproveHours?: number;
  inviteCode?: string | null;
  teamMembers: { id: string; user: { id: string; name: string; avatarUrl: string | null } }[];
  activations: Activation[];
  /** Every creator on the campaign, from activations and from posts. */
  roster: RosterRow[];
  /** The Overview and Analytics figures, over every post on the campaign. */
  summary: CampaignPostSummary;
  brief: { content: string } | null;
  /** The rollups the reference computes per campaign, shown on Financials. */
  creatorRateTotals?: number | null;
  commissionTotal?: number | null;
  profitTotal?: number | null;
  financials?: { totalBudget: number; spentAmount: number; notes: string | null } | null;
  /** The org's campaign tags applied to this campaign. */
  tagLinks?: { tag: { id: string; name: string } }[];
  _count: { activations: number; posts: number };
};

/**
 * The reference's "Select Tags" on a campaign's Overview, drawing on the
 * campaign tags defined in Settings → General.
 *
 * Sends the whole set on every change, like the creator label cards: the
 * control already knows the full selection, and a set cannot half-apply.
 */
function CampaignTagsCard({
  campaignId,
  selected,
  onSaved,
}: {
  campaignId: string;
  selected: { id: string; name: string }[];
  /** The saved selection, in the order sent -- the order the links are written in. */
  onSaved: (tags: { id: string; name: string }[]) => void;
}) {
  const [defs, setDefs] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/taxonomy/campaign-tags")
      .then((r) => r.json())
      .then((d) => setDefs(Array.isArray(d.items) ? d.items : []))
      .catch(() => setDefs([]));
  }, []);

  async function save(ids: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Could not save (${res.status})`);
      }
      /* Handed back rather than re-read: a tag change used to re-fetch the whole
         campaign, roster and post totals included, to learn the names of the
         tags this card had just chosen from its own list. */
      const known = new Map([...(defs ?? []), ...selected].map((t) => [t.id, t]));
      onSaved(ids.flatMap((tagId) => {
        const tag = known.get(tagId);
        return tag ? [tag] : [];
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const selectedIds = selected.map((s) => s.id);
  const available = (defs ?? []).filter((d) => !selectedIds.includes(d.id));

  const noDefs = defs !== null && defs.length === 0;

  return (
    <SectionCard title="Tags" className={noDefs && selected.length === 0 ? "cc-phone-hide" : undefined}>
      {selected.length === 0 ? (
        /* One line, not two: the empty card used to say "No tags added yet!"
           and then, under it, that no tags were defined either. */
        <p className="cc-campaign-card-note">
          No tags yet.
          {noDefs ? (
            <>
              {" "}<Link href="/settings/general">Add tags</Link>
            </>
          ) : null}
        </p>
      ) : (
        <div className="cc-campaign-tag-list">
          {selected.map((s) => (
            <span key={s.id} className="cc-campaign-tag">
              {s.name}
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                disabled={busy}
                onClick={() => void save(selectedIds.filter((v) => v !== s.id))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {defs === null ? null : available.length > 0 ? (
        <Dropdown
          ariaLabel="Add tag"
          value=""
          placeholder="Add tag"
          disabled={busy}
          align="left"
          minWidth={180}
          onChange={(v) => void save([...selectedIds, v])}
          options={available.map((d) => ({ value: d.id, label: d.name }))}
        />
      ) : noDefs ? (
        selected.length > 0 ? (
          <p className="cc-campaign-card-note">
            Define more campaign tags in <Link href="/settings/general">Settings → General</Link>.
          </p>
        ) : null
      ) : (
        <p className="cc-campaign-card-note">All tags applied.</p>
      )}

      {error && <p role="alert" className="cc-form-error">{error}</p>}
    </SectionCard>
  );
}

function LoadingSkeleton() {
  return (
    <div className="cc-page-content rsp-page" aria-busy="true">
      <PageHeaderSkeleton />
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <TileGridSkeleton count={4} />
        <Skeleton width="100%" height={300} radius="var(--cc-r-card)" />
      </div>
    </div>
  );
}

function editFormFrom(c: Campaign) {
  return {
    title: c.title,
    status: c.status,
    currency: c.currency,
    notes: c.notes ?? "",
    clientId: c.clientId ?? "",
    budget: c.budget != null ? String(c.budget) : "",
  };
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  /* The section belongs in the URL, as it does on the reference app: a link to
     a campaign's Posts opened on Performance, the back button walked out of the
     campaign instead of back a section, and a reload lost it entirely. Nothing
     here writes it any more -- the rail navigates with real links, so the
     browser does it, and the old in-page setter had no callers left. */
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = readCampaignSection(searchParams);
  /* Which roster columns are showing. In the URL rather than component state for
     the reason the list pages give: a configured table survives a refresh and
     can be pasted to a colleague, which is most of what the reference's saved
     "New View" is for. An unknown key is dropped rather than trusted. */
  const validColumnKeys = ROSTER_COLUMNS.map((c) => c.key);
  const colsParam = searchParams.get("cols");
  const columnKeys = colsParam === null
    ? ROSTER_DEFAULT_COLUMNS
    : colsParam.split(",").filter((k) => validColumnKeys.includes(k));
  const setColumnKeys = (keys: string[]) => {
    const next = new URLSearchParams(searchParams.toString());
    // The default set stays out of the URL entirely, so the address stays clean
    // until someone actually changes the columns.
    const isDefault =
      keys.length === ROSTER_DEFAULT_COLUMNS.length &&
      ROSTER_DEFAULT_COLUMNS.every((k) => keys.includes(k));
    if (isDefault) next.delete("cols");
    else next.set("cols", keys.join(","));
    router.replace(`?${next.toString()}`, { scroll: false });
  };
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignRules, setCampaignRules] = useState<CampaignRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddCreator, setShowAddCreator] = useState(false);
  const [addingCreator, setAddingCreator] = useState(false);
  const [selectedCreatorId, setSelectedCreatorId] = useState("");
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  // budget is held as a string so the field can be left empty, which means
  // "not recorded" rather than zero.
  const [editForm, setEditForm] = useState({
    title: "", status: "", currency: "USD", notes: "", clientId: "", budget: "",
  });
  const [saving, setSaving] = useState(false);

  // ─── Marketplace form state (major units in UI; converted to minor on save) ──
  const [mkt, setMkt] = useState({
    marketplaceVisibility: "PRIVATE" as "PRIVATE" | "GLOBAL" | "INVITE_ONLY",
    guidelines: "",
    requirements: "",
    contentAssetsUrl: "",
    rates: {} as Partial<Record<(typeof MARKETPLACE_PLATFORMS)[number], string>>,
    submissionDeadline: "",
    autoApproveHours: "48",
  });
  const [savingMkt, setSavingMkt] = useState(false);
  const [rotatingCode, setRotatingCode] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadCampaign = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    fetch(`/api/campaigns/${id}`)
      .then(async (r) => {
        // A 500 and a 404 used to collapse to the same null, so a dropped
        // connection told the reader their campaign had been deleted.
        if (r.status === 404) return { notFound: true, campaign: null } as const;
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        if (!data || data.error) return { notFound: true, campaign: null } as const;
        return { notFound: false, campaign: data as Campaign } as const;
      })
      .then((result) => {
        setCampaign(result.notFound ? null : result.campaign);
      })
      .catch(() => {
        setCampaign(null);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadCampaign(); }, [loadCampaign]);

  /* The edit and marketplace forms start from the campaign. Reset while
     rendering the campaign that changed rather than in an effect after it: the
     effect committed the whole page once with the old forms, then rendered it
     all again with the new ones. */
  const [formsFrom, setFormsFrom] = useState<Campaign | null>(null);
  if (campaign && campaign !== formsFrom) {
    setFormsFrom(campaign);
    setEditForm(editFormFrom(campaign));
    const rates: Partial<Record<(typeof MARKETPLACE_PLATFORMS)[number], string>> = {};
    const src = campaign.ratePerThousand ?? {};
    for (const p of MARKETPLACE_PLATFORMS) {
      const v = src[p];
      if (v != null) rates[p] = minorToMajor(v);
    }
    setMkt({
      marketplaceVisibility: campaign.marketplaceVisibility ?? "PRIVATE",
      guidelines: campaign.guidelines ?? "",
      requirements: campaign.requirements ?? "",
      contentAssetsUrl: campaign.contentAssetsUrl ?? "",
      rates,
      submissionDeadline: campaign.submissionDeadline
        ? campaign.submissionDeadline.slice(0, 10)
        : "",
      autoApproveHours: campaign.autoApproveHours != null ? String(campaign.autoApproveHours) : "48",
    });
  }


  /* Save waits for a change. The snapshot is the campaign the form was last
     reset from, so after a save (which hands back the new campaign) the form
     reads clean again without any bookkeeping here. */
  const savedEditForm = useMemo(() => (formsFrom ? editFormFrom(formsFrom) : null), [formsFrom]);
  const editDirty = useDirty(savedEditForm, editForm);

  useEffect(() => {
    if (activeTab === "edit" && !clientsLoaded) {
      fetchClients();
    }
  }, [activeTab]);

  const fetchClients = async () => {
    if (clientsLoaded) return;
    const res = await fetch("/api/clients");
    if (res.ok) {
      const data = await res.json();
      setClients(data.clients ?? []);
      setClientsLoaded(true);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: editForm.title,
        status: editForm.status,
        currency: editForm.currency,
        notes: editForm.notes || null,
        clientId: editForm.clientId || null,
        // Emptying the field unsets the budget; it must not become 0.
        budget: editForm.budget.trim() === "" ? null : Number(editForm.budget),
      };
        const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await mergeSaved(res);
        toast.success("Campaign updated");
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  const refreshCampaign = async () => {
    const refreshed = await fetch(`/api/campaigns/${id}`).then((r) => (r.ok ? r.json() : null));
    if (refreshed && !refreshed.error) setCampaign(refreshed);
    return refreshed;
  };

  /* A settings edit changes the campaign's own columns and nothing under it, and
     PATCH answers with that row (plus its tags, team, counts and client). Merge
     it rather than re-reading the campaign: the re-read rebuilt the roster and
     the post totals, which no edit here can move. The posts, drafts and
     add-creator paths still re-read, because those do move them. */
  const mergeSaved = async (res: Response) => {
    const saved = await res.json().catch(() => null);
    if (saved && !saved.error) setCampaign((prev) => (prev ? { ...prev, ...saved } : prev));
    else await refreshCampaign();
  };

  const applyTags = (tags: { id: string; name: string }[]) => {
    setCampaign((prev) => (prev ? { ...prev, tagLinks: tags.map((tag) => ({ tag })) } : prev));
  };

  const buildRatePayload = () => {
    const out: Record<string, number> = {};
    for (const p of MARKETPLACE_PLATFORMS) {
      const minor = majorToMinor(mkt.rates[p] ?? "");
      if (minor != null && minor > 0) out[p] = minor;
    }
    return out;
  };

  const handleSaveMarketplace = async () => {
    // Client-side guard mirrors the server gate for GLOBAL publishing.
    if (mkt.marketplaceVisibility === "GLOBAL") {
      /* With the rate inputs hidden, the rate that counts is the one already
         stored -- the same one the server's own gate falls back to. */
      const hasRate = SHOW_MONEY
        ? Object.keys(buildRatePayload()).length > 0
        : Object.values(campaign?.ratePerThousand ?? {}).some((v) => typeof v === "number" && v > 0);
      if (!editForm.title.trim() || !mkt.guidelines.trim() || !hasRate) {
        toast.error(
          SHOW_MONEY || hasRate
            ? "Public marketplace needs a title, guidelines, and at least one platform rate."
            : "Public marketplace needs a title, guidelines and a rate on file, and this campaign has no rate."
        );
        return;
      }
    }
    setSavingMkt(true);
    try {
      const payload: Record<string, unknown> = {
        marketplaceVisibility: mkt.marketplaceVisibility,
        guidelines: mkt.guidelines || null,
        requirements: mkt.requirements || null,
        contentAssetsUrl: mkt.contentAssetsUrl || "",
        /* Not sent while the inputs are hidden: absent keeps the stored
           rates, an empty object would erase them. */
        ...(SHOW_MONEY ? { ratePerThousand: buildRatePayload() } : {}),
        submissionDeadline: mkt.submissionDeadline ? new Date(mkt.submissionDeadline).toISOString() : null,
        autoApproveHours: mkt.autoApproveHours ? Number(mkt.autoApproveHours) : 48,
      };
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await mergeSaved(res);
        toast.success("Marketplace settings saved");
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to save marketplace settings");
      }
    } finally {
      setSavingMkt(false);
    }
  };

  const handleRotateInviteCode = async () => {
    setRotatingCode(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerateInviteCode: true }),
      });
      if (res.ok) {
        await mergeSaved(res);
        toast.success("Invite code regenerated");
      } else {
        toast.error("Failed to regenerate invite code");
      }
    } finally {
      setRotatingCode(false);
    }
  };

  const handleAddCreator = async () => {
    if (!selectedCreatorId) return;
    setAddingCreator(true);
    try {
      const res = await fetch("/api/activations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: id, creatorId: selectedCreatorId }),
      });
      if (res.ok) {
        const updated = await fetch(`/api/campaigns/${id}`).then(r => r.json());
        setCampaign(updated);
        setShowAddCreator(false);
        setSelectedCreatorId("");
      }
    } finally {
      setAddingCreator(false);
    }
  };

  const pendingDrafts = (campaign?.activations ?? []).filter(
    (a) => a.status === "DRAFT_SUBMITTED" || a.status === "AWAITING_APPROVAL"
  ).length;

  const draftsEver = (campaign?.activations ?? []).filter((a) => {
    const d = a as { draftSubmittedAt?: unknown; draftUrl?: unknown };
    return Boolean(d.draftSubmittedAt || d.draftUrl);
  }).length;

  const roster = campaign?.roster ?? [];

  /* What the rail shows beside each section. The rail lives in the dashboard
     layout, above this page, so the counts travel up through the provider
     rather than the sidebar fetching this campaign a second time. */
  const publishCampaignNav = useCampaignNavPublish();
  const campaignListHref = useCampaignListHref();
  const campaignMissing = !loading && !loadError && !campaign;
  useEffect(() => {
    publishCampaignNav({
      title: campaign?.title ?? null,
      missing: campaignMissing,
      counts: {
        drafts: pendingDrafts || undefined,
        draftsEver: draftsEver || undefined,
        posts: campaign?._count.posts || undefined,
        creators: roster.length || undefined,
      },
    });
  }, [campaign?.title, campaign?._count.posts, pendingDrafts, draftsEver, roster.length, campaignMissing, publishCampaignNav]);

  if (loading) return <LoadingSkeleton />;
  if (loadError) return (
    <div className="cc-page-content">
      <EmptyState
        icon={<AlertTriangle size={32} color="var(--cc-text-subtle)" />}
        title="Couldn't load this campaign"
        description="The request failed. The campaign is still there — try again."
        action={<Button variant="secondary" onClick={loadCampaign}>Retry</Button>}
      />
    </div>
  );
  if (!campaign) return (
    <div className="cc-page-content">
      <NotFoundState
        icon={<ClipboardList size={32} />}
        title="Campaign not found"
        description="This campaign doesn't exist, was deleted, or belongs to another workspace."
        primary={{ href: campaignListHref, label: "Back to campaigns" }}
      />
    </div>
  );

  const summary = campaign.summary;
  const totalViews = summary.views;
  /* When the total was read (our read, else the import's refresh -- see
     postMeasuredAt, applied server-side in lib/campaigns/detailSummary) and how
     many posts it covers: the same caption the Performance tab and the Posts
     strip carry, so the tile keeps the "views known for N of M posts" it had
     and gains the time. */
  const viewsNote = asOfCaption(summary.viewsAsOf, { known: summary.viewsKnownPosts, total: summary.posts, what: "views" });
  /* A sum over no read post is unknown, not a measured 0. */
  const totalViewsText = summary.viewsKnownPosts === 0 && summary.posts > 0 ? "\u2014" : formatNumber(totalViews);
  /* Progress toward the view goal, over the views read so far; not shown
     while no post's views are known. */
  const goalProgress = summary.viewsKnownPosts > 0 ? viewGoalProgress(summary.views, campaignRules?.viewGoal) : null;
  const goal = goalProgress && campaignRules?.viewGoal ? { ...goalProgress, target: campaignRules.viewGoal } : null;
  const totalLikes = summary.likes;
  // Likes are summed straight off the column, whose default is 0, so a campaign
  // whose likes were never read showed "Total Likes 0". Shown only when at
  // least one post's likes were actually measured.
  const likesMeasured = summary.likesMeasured;
  /* The product's one engagement-rate definition (rollupEngagement), shared with
     the Posts tab, the Performance tab and the client report, taken over every
     post by the server. null means no post on the campaign has been measured. */
  const engagement = { rate: summary.engagementRate, engagements: summary.engagements };
  const avgEngagement = engagement.rate === null ? null : engagement.rate * 100;
  const reach = followersReached(roster);
  const reachNote = reach.counted < reach.posting
    ? `across ${reach.counted} of ${reach.posting} posting creators`
    : `across ${reach.counted} posting ${noun(reach.counted, "creator")}`;
  /* The Overview tiles share one figure size, set by the longest of them. */
  const overviewFit = Math.max(
    totalViewsText.length,
    avgEngagement === null ? 0 : (avgEngagement.toFixed(2) + "%").length,
    reach.counted > 0 ? formatNumber(reach.followers).length : String(roster.length).length,
    campaign.budget == null ? 0 : formatFullCurrency(campaign.budget, campaign.currency).length,
  );

  const platformSplitRows = summary.platforms
    .filter((stats) => stats.posts > 0 || stats.views > 0)
    .map((stats) => ({ platform: stats.platform, views: stats.views > 0 ? stats.views : null, posts: stats.posts }));
  /* The Analytics tiles share one figure size, set by the longest of them. */
  const analyticsFit = Math.max(
    totalViewsText.length,
    likesMeasured ? formatNumber(totalLikes).length : 0,
    avgEngagement === null ? 0 : (avgEngagement.toFixed(2) + "%").length,
    engagement.engagements === null ? 0 : formatNumber(engagement.engagements).length,
    formatNumber(summary.posts).length,
  );

  /* The leaders only, already chosen and ordered by the server: drawing every
     creator's bar pair measured all their tick labels in the DOM -- a single
     290ms task at 4x CPU, which put this tab over the 200ms Total Blocking Time
     budget on its own. */
  const creatorCount = summary.creatorCount;
  const creatorBarData = summary.topCreators.map((stats) => ({
    name: stats.name.split(" ")[0], views: stats.views, likes: stats.likes,
  }));

  return (
    <div className="cc-page-content rsp-page">
      {/* The shared header band: back to the campaign list (the same place
          the rail's "All campaigns" goes -- a link, never history.back(), so
          a deep-linked visitor is not sent off-site), the status as a badge
          with its dot, and the campaign's type as a fact in the line under
          the title rather than a second chip that looked like a status.

          The section's own actions portal into the span between Share
          Campaign and the menu, through CampaignHeaderActions. Share is the
          page's own child, so every section has it and it comes first: it is
          in the row when the page commits, before any section's portal
          mounts. */}
      <PageHeader
        title={campaign.title}
        back={{ href: campaignListHref, label: "Campaigns" }}
        badges={
          <StatusBadge status={campaign.status} dot>
            {campaignStatusText(campaign.status)}
          </StatusBadge>
        }
        meta={
          <>
            <span>
              <Calendar size={14} aria-hidden="true" />
              {formatDateAbs(campaign.createdAt)}
            </span>
            {campaign.campaignType ? (
              <span>{CAMPAIGN_TYPE_LABELS[campaign.campaignType] ?? campaign.campaignType}</span>
            ) : null}
            <span>{roster.length} {noun(roster.length, "creator")}</span>
            <span>{campaign._count.posts} {noun(campaign._count.posts, "post")}</span>
          </>
        }
        actions={
          <>
            <CampaignShareButton campaignId={id} campaignTitle={campaign.title} />
            <span id={CAMPAIGN_HEADER_ACTIONS_ID} className="cc-header-portal" />
            <SaveAsTemplateAction campaignId={id} campaignTitle={campaign.title} />
          </>
        }
      />
      <CampaignPhoneTabs campaignId={id} />

      {/* No longer a tabpanel: the control that opens this is a link in the
          rail, so role="tabpanel" would name a tab that does not exist and
          aria-labelledby would point at a removed id. It is a region, labelled
          by the heading the section renders. */}
      <motion.div
        key={activeTab}
        id="campaign-section-panel"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {/* Performance */}
        {activeTab === "performance" && (
          <PerformanceTab campaignId={id} />
        )}

        {/* Overview */}
        {activeTab === "overview" && (
          /* Their Overview is two columns of 667.4 inside the same 1362 content
             box, split 1fr/1fr with a 27.2px gutter, and the Activity panel is
             the right one -- MEASURED at x=917.6. The three wrappers exist only
             so grid can place them; at base they are `display: contents`, so
             light and dark still render one flat 24px column in this exact DOM
             order, which is why Activity is the middle wrapper rather than the
             last. */
          <div className="cc-overview-grid">
            <div className="cc-overview-main">
            {/* A figure nobody recorded is not shown at all: budget is optional to
                enter, and engagement is absent on most imported posts. Neither
                gets a zero or a dash standing in for the real number. */}
            <div className="cc-tiles-balanced">
              <MetricTile
                fitTo={overviewFit}
                metric="totalViews"
                value={totalViewsText}
                footer={
                  goal ? (
                    <>
                      <span data-testid="view-goal">
                        {formatFull(summary.views)} of {formatFull(goal.target)} goal ({goal.pct}%)
                      </span>
                      {viewsNote ? <><br />{viewsNote}</> : null}
                    </>
                  ) : viewsNote
                }
              />
              {/* "Engagement rate", not "Avg engagement": the label described the
                  old mean-of-means and would now misname the figure below it. */}
              {avgEngagement !== null && (
                <MetricTile fitTo={overviewFit} metric="engagementRate" value={avgEngagement.toFixed(2) + "%"} />
              )}
              {/* Combined followers, not a creator count: the count is already
                  in the header line ("40 creators · 80 posts"), and what a
                  client asks after "how many views" is "in front of how many
                  people". A creator whose followers were never read is left
                  out and named in the footer, never summed in as 0. */}
              {reach.counted > 0 ? (
                <MetricTile fitTo={overviewFit} metric="followersReached" value={formatNumber(reach.followers)} footer={reachNote} />
              ) : (
                <MetricTile fitTo={overviewFit} metric="campaignCreators" value={String(roster.length)} />
              )}
              {campaign.budget != null && (
                /* `budget`, not `totalBudget`: this is one campaign's own cap.
                   totalBudget's help says "across all campaigns in this date
                   range", which is a different number and a range this page
                   does not have. */
                <MetricTile fitTo={overviewFit} metric="budget" value={formatFullCurrency(campaign.budget, campaign.currency)} />
              )}
              </div>
            </div>

            <div className="cc-overview-side">
              <ActivityFeed campaignId={campaign.id} />
            </div>

            <div className="cc-overview-main">
            <CampaignTagsCard
              campaignId={campaign.id}
              selected={(campaign.tagLinks ?? []).map((l) => l.tag)}
              onSaved={applyTags}
            />

            {/* Brief */}
            <CreativeBriefCard
              campaignId={campaign.id}
              initialContent={campaign.brief?.content ?? ""}
            />

            {/* Checklist, submission rules, launch and goal (lib/campaigns/rules).
                Renders nothing until the database has its table. */}
            <CampaignRulesCard campaignId={campaign.id} onRules={setCampaignRules} />

            {/* Notes */}
            {campaign.notes && (
              <SectionCard title="Notes">
                <p className="cc-campaign-notes">{campaign.notes}</p>
              </SectionCard>
            )}

            {/* Team */}
            {campaign.teamMembers.length > 0 && (
              <SectionCard title="Team">
                <div className="cc-campaign-team-list">
                  {campaign.teamMembers.map(tm => (
                    <span key={tm.id} className="cc-campaign-team-member">
                      <Avatar name={tm.user.name} size="sm" />
                      {tm.user.name}
                    </span>
                  ))}
                </div>
              </SectionCard>
            )}
            </div>
          </div>
        )}

        {/* Drafts Tab */}
        {activeTab === "drafts" && <DraftsTab campaignId={id} onChange={refreshCampaign} />}

        {/* Posts Tab */}
        {activeTab === "posts" && (
          <PostsTab
            campaignId={id}
            postApprovalMode={(campaign as any).postApprovalMode ?? "MANUAL"}
            onRefreshed={refreshCampaign}
            marketplace={
              campaign.marketplaceVisibility && campaign.marketplaceVisibility !== "PRIVATE"
                ? {
                    currency: campaign.currency,
                    ratePerThousand: campaign.ratePerThousand ?? null,
                    budgetCapMinor: campaign.marketplaceBudgetCapMinor ?? null,
                    autoApproveHours: campaign.autoApproveHours ?? 48,
                    submissionDeadline: campaign.submissionDeadline ?? null,
                  }
                : null
            }
          />
        )}

        {/* Creators Tab */}
        {activeTab === "creators" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <RosterTable
              rows={roster}
              campaignId={id}
              currency={campaign.currency}
              columnKeys={columnKeys}
              onColumnKeysChange={setColumnKeys}
              onAddCreator={() => setShowAddCreator(true)}
            />

            {/* Proposals and Negotiations sat either side of Invites until
                October 2026; both were money, and left with payments. */}
            <InvitesSection campaignId={id} />
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === "analytics" && (
          <div className="cc-campaign-analytics">
            {campaign.marketplaceVisibility && campaign.marketplaceVisibility !== "PRIVATE" && (
              <section aria-labelledby="campaign-marketplace-analytics">
                <h2 id="campaign-marketplace-analytics" className="cc-section-card-title cc-campaign-analytics-heading">Marketplace</h2>
                <MarketplaceAnalytics campaignId={id} currency={campaign.currency ?? "USD"} />
              </section>
            )}
            {(summary.posts === 0 ? (
            <EmptyState icon={<TrendingUp size={32} color="var(--cc-text-subtle)" />} title="No analytics yet" description="Analytics will be available once posts are synced." />
          ) : (
            <>
              {/* The figures lead, then the charts. They were five chips in a
                  card whose ground matched the page, at three figure sizes
                  (16, 16, 22, 22, 22px), with one label wrapping so its value
                  sat 16px lower; they are the shared tile now, the same row
                  the Overview and Performance sections draw. A figure nobody
                  measured is left out rather than shown as 0. */}
              <div className="cc-tiles-balanced">
                <MetricTile fitTo={analyticsFit} metric="totalViews" value={totalViewsText} footer={viewsNote} />
                {likesMeasured && (
                  <MetricTile fitTo={analyticsFit} metric="totalLikes" value={formatNumber(totalLikes)} />
                )}
                {/* The campaign-wide rate from rollupEngagement, not a per-post
                    average, so it is labelled as the campaign's. */}
                {avgEngagement !== null && (
                  <MetricTile fitTo={analyticsFit} metric="engagementRate" label="Campaign engagement rate" value={avgEngagement.toFixed(2) + "%"} />
                )}
                {/* The numerator the rate beside it is computed from, so the
                    two always agree. */}
                {engagement.engagements !== null && (
                  <MetricTile fitTo={analyticsFit} metric="engagements" label="Total engagement" value={formatNumber(engagement.engagements)} />
                )}
                <MetricTile fitTo={analyticsFit} metric="totalPosts" label="Posts" value={formatNumber(summary.posts)} />
              </div>

              <div className="rsp-grid-2 cc-campaign-analytics-charts">
                {/* A ranked list rather than a donut: each platform's share,
                    figure and post count on one line, sorted biggest first. A
                    platform whose posts have no view count read yet (views 0
                    over its posts) reads "—", not 0. */}
                <SectionCard title="Views by platform">
                  {platformSplitRows.some((r) => r.views !== null) ? (
                    <PlatformSplit rows={platformSplitRows} ariaLabel="Views by platform" />
                  ) : (
                    <p className="cc-campaign-card-note">No views measured yet.</p>
                  )}
                </SectionCard>

                <SectionCard
                  title="Creator performance"
                  description={creatorCount > TOP_CREATOR_BARS ? `Top ${TOP_CREATOR_BARS} of ${creatorCount} creators, by views` : undefined}
                >
                  {creatorBarData.length > 0 ? (
                    <div style={{ height: 240 }}>
                      <CreatorPerformanceBar data={creatorBarData} formatNumber={formatNumber} />
                    </div>
                  ) : (
                    <p className="cc-campaign-card-note">No creator data yet.</p>
                  )}
                </SectionCard>
              </div>
            </>
          ))}
          </div>
        )}

        {/* Edit Tab */}
        {activeTab === "edit" && (
          <div className="cc-campaign-settings">
            <div>
              <CampaignPictureCard
                key={`${campaign.id}:${campaign.thumbnailUrl ?? ""}`}
                campaignId={id}
                thumbnailUrl={campaign.thumbnailUrl ?? null}
                hasSound={Boolean(campaign.songId)}
                version={campaign.updatedAt}
              />
            </div>
            <SectionCard title="Campaign details">
              <div className="cc-campaign-form">
                <Field label="Campaign title" required>
                  <Input
                    id="edit-campaign-title"
                    type="text"
                    value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  />
                </Field>
                <FieldRow>
                  <Field label="Status">
                    <Dropdown
                      id="edit-campaign-status"
                      size="md"
                      fullWidth
                      align="left"
                      value={editForm.status}
                      onChange={v => setEditForm(f => ({ ...f, status: v }))}
                      options={CAMPAIGN_STATUS_OPTIONS}
                    />
                  </Field>
                  <Field label="Currency">
                    <Dropdown
                      id="edit-campaign-currency"
                      size="md"
                      fullWidth
                      align="left"
                      value={editForm.currency}
                      onChange={v => setEditForm(f => ({ ...f, currency: v }))}
                      options={["USD", "EUR", "GBP", "INR"].map(c => ({ value: c, label: c }))}
                    />
                  </Field>
                </FieldRow>
                <Field label="Budget" helper="Leave blank if you are not tracking one.">
                  <Input
                    id="edit-budget"
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={editForm.budget}
                    onChange={e => setEditForm(f => ({ ...f, budget: e.target.value }))}
                  />
                </Field>
                {/* Searched rather than scrolled. A dropdown listing every
                    client is fine at five and useless at two hundred.
                    Clearing the picker unsets the client. */}
                <Field label="Client">
                  <EntityPicker
                    id="edit-client"
                    endpoint="/api/clients"
                    placeholder="Search clients"
                    extract={(json) => (json.clients ?? []).map((c: { id: string; name: string }) => ({ id: c.id, label: c.name }))}
                    value={
                      editForm.clientId
                        ? {
                            id: editForm.clientId,
                            label:
                              clients.find(c => c.id === editForm.clientId)?.name
                              ?? campaign.client?.name
                              ?? "Selected client",
                          }
                        : null
                    }
                    onChange={(opt) => setEditForm(f => ({ ...f, clientId: opt?.id ?? "" }))}
                  />
                </Field>
                <Field label="Notes">
                  <Textarea
                    id="edit-notes"
                    value={editForm.notes}
                    onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                    rows={3}
                  />
                </Field>
                <div className="cc-campaign-form-actions">
                  <Button
                    variant="primary"
                    onClick={handleSave}
                    disabled={!editDirty || saving || editForm.title.trim() === ""}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </div>
            </SectionCard>

            {/* The campaign's sound, added and changed here rather than from a
                button on the report: it is a property of the campaign, asked
                for when one is created and edited alongside the rest of it. */}
            <div>
              <CampaignAudioSetup campaignId={id} />
            </div>

            <CampaignSwitchesCard campaignId={id} />

            {/* ─── Marketplace section (Phase 2M) ─── */}
            <SectionCard
              className="cc-campaign-settings-card"
              title="Marketplace"
              description={`Control how creators discover and join this campaign.${SHOW_MONEY ? ` Rates are shown in ${campaign.currency} and stored to the cent.` : ""}`}
            >
              <div className="cc-campaign-form">
                {/* Visibility picker */}
                <div>
                  <div id="mkt-visibility-label" className="cc-form-label">Visibility</div>
                  <div role="radiogroup" aria-labelledby="mkt-visibility-label" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {VISIBILITY_OPTIONS.map((opt) => {
                      const selected = mkt.marketplaceVisibility === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setMkt((m) => ({ ...m, marketplaceVisibility: opt.value }))}
                          style={{
                            display: "block", width: "100%", textAlign: "left", font: "inherit",
                            padding: 14, borderRadius: 10, cursor: "pointer",
                            border: `2px solid ${selected ? "var(--cc-primary)" : "var(--cc-border)"}`,
                            background: selected ? "var(--cc-primary-light)" : "var(--cc-card)",
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{opt.label}</span>
                            {selected && <Badge variant="accent">Selected</Badge>}
                          </span>
                          <span style={{ display: "block", fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginTop: 4 }}>{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Invite code (INVITE_ONLY only) */}
                {mkt.marketplaceVisibility === "INVITE_ONLY" && (
                  <Field
                    group
                    label="Invite code"
                    helper="Share this code with invited creators. A new code is generated when you first save; regenerating invalidates the old one."
                  >
                    <div className="cc-campaign-invite-code">
                      <code>{campaign.inviteCode ?? "— saved on first save —"}</code>
                      <Button
                        variant="secondary"
                        onClick={handleRotateInviteCode}
                        disabled={rotatingCode || !campaign.inviteCode}
                      >
                        {rotatingCode ? "Rotating…" : "Regenerate"}
                      </Button>
                    </div>
                  </Field>
                )}

                {/* Brief editor */}
                <Field label="Guidelines" required={mkt.marketplaceVisibility === "GLOBAL"}>
                  <Textarea
                    id="mkt-guidelines"
                    value={mkt.guidelines}
                    onChange={(e) => setMkt((m) => ({ ...m, guidelines: e.target.value }))}
                    rows={4}
                    placeholder="What should creators make? Tone, hooks, must-include beats"
                  />
                </Field>
                <Field label="Requirements">
                  <Textarea
                    id="mkt-requirements"
                    value={mkt.requirements}
                    onChange={(e) => setMkt((m) => ({ ...m, requirements: e.target.value }))}
                    rows={3}
                    placeholder="Minimum length, hashtags, disclosure, do's and don'ts"
                  />
                </Field>
                <Field label="Content assets URL">
                  <Input
                    id="mkt-assets-url"
                    type="url"
                    value={mkt.contentAssetsUrl}
                    onChange={(e) => setMkt((m) => ({ ...m, contentAssetsUrl: e.target.value }))}
                    placeholder="https://drive.google.com/"
                  />
                </Field>

                {/* Per-platform rates (major units → stored minor). Hidden while
                    SHOW_MONEY is off; see lib/moneyUi for why that is safe. */}
                {SHOW_MONEY && (
                  <Field
                    group
                    label="Rate per 1,000 verified views"
                    required={mkt.marketplaceVisibility === "GLOBAL"}
                    helper={`Set a payout rate per platform (in ${campaign.currency}). Leave blank to exclude a platform.`}
                  >
                    <div className="rsp-grid-2">
                      {MARKETPLACE_PLATFORMS.map((p) => (
                        <Field key={p} label={platformLabel(p)}>
                          <Input
                            id={`mkt-rate-${p}`}
                            type="number" min="0" step="0.01"
                            value={mkt.rates[p] ?? ""}
                            onChange={(e) => setMkt((m) => ({ ...m, rates: { ...m.rates, [p]: e.target.value } }))}
                            placeholder="e.g. 1.50"
                          />
                        </Field>
                      ))}
                    </div>
                  </Field>
                )}

                {/* Deadline + auto-approve */}
                <FieldRow>
                  <Field label="Submission deadline">
                    <Input
                      id="mkt-deadline"
                      type="date"
                      value={mkt.submissionDeadline}
                      onChange={(e) => setMkt((m) => ({ ...m, submissionDeadline: e.target.value }))}
                    />
                  </Field>
                  <Field label="Auto-approve after (hours)">
                    <Input
                      id="mkt-auto-approve"
                      type="number" min="1" max="720"
                      value={mkt.autoApproveHours}
                      onChange={(e) => setMkt((m) => ({ ...m, autoApproveHours: e.target.value }))}
                      placeholder="48"
                    />
                  </Field>
                </FieldRow>

                {/* Public URL preview */}
                <Field group label="Public page">
                  <div className="cc-campaign-public-url">
                    {campaign.publicSlug ? (
                      <span style={{ color: "var(--cc-text)" }}>/explore/{campaign.publicSlug}</span>
                    ) : mkt.marketplaceVisibility === "GLOBAL" ? (
                      <span>A public URL like <code>/explore/your-campaign-abc123</code> is created when you first publish.</span>
                    ) : (
                      <span>Set visibility to <strong>Public marketplace</strong> and save to generate a public URL.</span>
                    )}
                  </div>
                </Field>

                <div className="cc-campaign-form-actions">
                  <Button variant="primary" onClick={handleSaveMarketplace} disabled={savingMkt}>
                    {savingMkt ? "Saving…" : "Save marketplace settings"}
                  </Button>
                </div>
              </div>
            </SectionCard>
          </div>
        )}
      </motion.div>

      {showAddCreator && (
        <Modal
          open
          onClose={() => { setShowAddCreator(false); setSelectedCreatorId(""); }}
          icon={UserPlus}
          tone="brand"
          title="Add creator to campaign"
          description="Search your roster by name or handle. Creators already on this campaign are marked Added."
          size="md"
          footer={
            <div className="cc-modal-footer">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setShowAddCreator(false); setSelectedCreatorId(""); }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddCreator}
                disabled={!selectedCreatorId || addingCreator}
                iconLeft={<UserPlus size={16} aria-hidden="true" />}
              >
                {addingCreator ? "Adding…" : "Add creator"}
              </Button>
            </div>
          }
        >
          <CreatorSelect
            value={selectedCreatorId}
            onChange={(id) => setSelectedCreatorId(id)}
            excludeIds={campaign?.activations.map((a: Activation) => a.creator.id) ?? []}
          />
        </Modal>
      )}
    </div>
  );
}
