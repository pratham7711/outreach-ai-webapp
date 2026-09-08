"use client";
import type { CSSProperties } from "react";
import { useState, useEffect, useCallback, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Card, Badge, EmptyState, Avatar, Skeleton, Modal } from "@pratham7711/ui";
import { Dropdown, MetricTile, EntityPicker, Button } from "@/components/ds";
import PostsTab from "./PostsTab";
import ActivityFeed from "./ActivityFeed";
import DraftsTab from "./DraftsTab";
import DocumentsTab from "./DocumentsTab";
import FinancialsTab from "./FinancialsTab";
import CreativeBriefCard from "./CreativeBriefCard";
import RosterTable, { ROSTER_COLUMNS, ROSTER_DEFAULT_COLUMNS } from "./RosterTable";
import InvitesSection from "./InvitesSection";
import NegotiationsSection from "./NegotiationsSection";
import ProposalsSection from "./ProposalsSection";
import ReviewsSection from "./ReviewsSection";
import {
  ArrowLeft, Eye, Heart, MessageCircle, Share2, TrendingUp, Users,
  Calendar, Play, ChevronRight, ExternalLink, DollarSign,
  ClipboardList, BarChart3, Wallet, Trash2, AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { formatCompact, formatCompactCurrency, formatDateAbs } from "@/lib/format";
import { rollupEngagement } from "@/lib/metricDisplay";
import { CreatorSelect } from "@/components/CreatorSelect";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import { loadCharts } from "@/components/charts/lazyCharts";

const ChartSkeleton = ({ height }: { height: number }) => (
  <Skeleton width="100%" height={`${height}px`} borderRadius="12px" />
);

const PerformanceTab = dynamic(() => loadCharts().then((m) => m.PerformanceTab), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="rsp-grid-tiles">
        {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height="88px" borderRadius="12px" />)}
      </div>
      <Skeleton width="100%" height="320px" borderRadius="12px" />
    </div>
  ),
});

const MarketplaceAnalytics = dynamic(() => loadCharts().then((m) => m.MarketplaceAnalytics), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="240px" borderRadius="12px" />,
});

const PlatformViewsPie = dynamic(() => loadCharts().then((m) => m.PlatformViewsPie), {
  ssr: false,
  loading: () => <ChartSkeleton height={240} />,
});

const CreatorPerformanceBar = dynamic(() => loadCharts().then((m) => m.CreatorPerformanceBar), {
  ssr: false,
  loading: () => <ChartSkeleton height={240} />,
});

/* One list, and the union read off it: a tab added to a hand-written union but
   not to the list would type-check and then silently fall back to Performance
   whenever someone linked to it. */
const TAB_VALUES = [
  "performance", "overview", "drafts", "posts", "creators", "reviews", "analytics", "financials", "documents", "edit",
] as const;

type Tab = (typeof TAB_VALUES)[number];

function tabFromParam(raw: string | null): Tab {
  return TAB_VALUES.includes(raw as Tab) ? (raw as Tab) : "performance";
}

function formatNumber(num: number): string {
  return formatCompact(num);
}

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

const STATUS_BADGE: Record<string, "success" | "warning" | "accent" | "neutral"> = {
  DRAFT: "neutral",
  PENDING: "warning",
  IN_PROGRESS: "accent",
  COMPLETE: "success",
  CANCELLED: "neutral",
};

type Post = {
  id: string;
  platform: string;
  postUrl: string;
  caption: string | null;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  engagementRate: number;
  /* Provenance for the counters above. GET /api/campaigns/[id] has always
     returned it -- the type here simply did not name it, which is how the
     Overview tile came to average a column of never-measured zeroes. */
  lastSyncedAt: string | null;
  creator: {
    id: string; name: string; handle: string; platform: string;
    avatarUrl: string | null; followersCount: number; rate: number | null;
  };
};

// A campaign's creator roster, merged from both sources: activations (formally
// assigned) and posts (actually delivered). Imported CreatorCore campaigns have
// only the latter, so an activations-only list left 506 of 512 campaigns
// showing "No creators yet" beside dozens of real posts.
type RosterEntry = {
  creator: Post["creator"];
  activationStatus: string | null;
  deliverableDueDate: string | null;
  posts: number;
  views: number;
};

function buildRoster(activations: Activation[], posts: Post[]): RosterEntry[] {
  const byCreator = new Map<string, RosterEntry>();
  for (const act of activations) {
    byCreator.set(act.creator.id, {
      creator: act.creator,
      activationStatus: act.status,
      // Carried through so the roster can offer a Due column. This was read off
      // the activation and then dropped.
      deliverableDueDate: act.deliverableDueDate,
      posts: 0,
      views: 0,
    });
  }
  for (const post of posts) {
    if (!post.creator) continue;
    const entry = byCreator.get(post.creator.id) ?? {
      creator: post.creator,
      activationStatus: null,
      deliverableDueDate: null,
      posts: 0,
      views: 0,
    };
    entry.posts += 1;
    entry.views += post.viewsCount ?? 0;
    byCreator.set(post.creator.id, entry);
  }
  return [...byCreator.values()].sort((a, b) => b.views - a.views || b.posts - a.posts);
}

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
  BUDGET_BASED: "Budget Based",
  VIEW_BASED: "View Based",
  OPEN_COMMUNITY: "Open Community",
  PRIVATE_INVITE: "Private Invite",
};

const CAMPAIGN_TYPE_BADGE: Record<string, "accent" | "success" | "warning" | "neutral"> = {
  BUDGET_BASED: "accent",
  VIEW_BASED: "success",
  OPEN_COMMUNITY: "warning",
  PRIVATE_INVITE: "neutral",
};

// ─── Marketplace (Phase 2M) ────────────────────────────────────────────────
const MARKETPLACE_PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"] as const;

const VISIBILITY_OPTIONS: { value: "PRIVATE" | "GLOBAL" | "INVITE_ONLY"; label: string; desc: string }[] = [
  { value: "PRIVATE", label: "Private", desc: "Managed by your team only — not listed anywhere public." },
  { value: "GLOBAL", label: "Public marketplace", desc: "Listed on the public /explore page. Any creator can discover and join." },
  { value: "INVITE_ONLY", label: "Invite only", desc: "Reachable only by creators who have your invite code." },
];

const mktLabel: CSSProperties = {
  display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6,
};
const mktInput: CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)",
  fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", boxSizing: "border-box",
};
const mktTextarea: CSSProperties = {
  ...mktInput, resize: "vertical", fontFamily: "inherit",
};

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
  posts: Post[];
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
  onSaved: () => void;
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
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const selectedIds = selected.map((s) => s.id);
  const available = (defs ?? []).filter((d) => !selectedIds.includes(d.id));

  return (
    <Card variant="outlined" style={{ padding: 24 }}>
      <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>
        Tags
      </span>

      {selected.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>No tags added yet!</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {selected.map((s) => (
            <span
              key={s.id}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                borderRadius: 8, padding: "6px 8px 6px 12px", fontSize: 13, color: "var(--cc-text)",
              }}
            >
              {s.name}
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                disabled={busy}
                onClick={() => void save(selectedIds.filter((v) => v !== s.id))}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", display: "inline-flex", padding: 0 }}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {defs === null ? null : available.length > 0 ? (
        <Dropdown
          ariaLabel="Add Tag"
          value=""
          placeholder="Add Tag"
          disabled={busy}
          align="left"
          minWidth={180}
          onChange={(v) => void save([...selectedIds, v])}
          options={available.map((d) => ({ value: d.id, label: d.name }))}
        />
      ) : (
        <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
          {(defs ?? []).length === 0
            ? "No campaign tags defined yet — add them in Settings → General."
            : "All tags applied."}
        </p>
      )}

      {error && <p role="alert" style={{ marginTop: 8, fontSize: 12, color: "var(--cc-danger)" }}>{error}</p>}
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="cc-page-content" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Skeleton width="120px" height="16px" />
      <Skeleton width="300px" height="32px" />
      <div className="rsp-grid-tiles">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} height="80px" borderRadius="10px" />)}
      </div>
      <Skeleton width="100%" height="300px" borderRadius="12px" />
    </div>
  );
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  /* The tab belongs in the URL, as it does on the reference app: a link to a
     campaign's Posts opened on Performance, the back button walked out of the
     campaign instead of back a tab, and a reload lost the tab entirely.
     replace, not push, so one visit does not fill the history with tabs. */
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = tabFromParam(searchParams.get("tab"));
  const setActiveTab = (tab: Tab) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.replace(`?${next.toString()}`, { scroll: false });
  };
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

  useEffect(() => {
    if (campaign) {
      setEditForm({
        title: campaign.title,
        status: campaign.status,
        currency: campaign.currency,
        notes: campaign.notes ?? "",
        clientId: campaign.clientId ?? "",
        budget: campaign.budget != null ? String(campaign.budget) : "",
      });
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
  }, [campaign]);

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
        const refreshed = await fetch(`/api/campaigns/${id}`).then((r) => (r.ok ? r.json() : null));
        if (refreshed && !refreshed.error) setCampaign(refreshed);
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
      const hasRate = Object.keys(buildRatePayload()).length > 0;
      if (!editForm.title.trim() || !mkt.guidelines.trim() || !hasRate) {
        toast.error("Public marketplace needs a title, guidelines, and at least one platform rate.");
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
        ratePerThousand: buildRatePayload(),
        submissionDeadline: mkt.submissionDeadline ? new Date(mkt.submissionDeadline).toISOString() : null,
        autoApproveHours: mkt.autoApproveHours ? Number(mkt.autoApproveHours) : 48,
      };
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await refreshCampaign();
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
        await refreshCampaign();
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

  const roster = buildRoster(campaign?.activations ?? [], campaign?.posts ?? []);

  const tabsList: { label: string; value: Tab; count?: number }[] = [
    { label: "Performance", value: "performance" },
    { label: "Overview", value: "overview" },
    { label: "Drafts", value: "drafts" as Tab, count: pendingDrafts || undefined },
    { label: "Posts", value: "posts", count: campaign?._count.posts },
    { label: "Creators", value: "creators", count: roster.length },
    { label: "Reviews", value: "reviews" as Tab },
    { label: "Analytics", value: "analytics" },
    { label: "Financials", value: "financials" as Tab },
    { label: "Documents", value: "documents" as Tab },
    { label: "Edit", value: "edit" as Tab },
  ];

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
      <EmptyState icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />} title="Campaign not found" description="This campaign may have been deleted." />
    </div>
  );

  const totalViews = campaign.posts.reduce((s, p) => s + p.viewsCount, 0);
  const totalLikes = campaign.posts.reduce((s, p) => s + p.likesCount, 0);
  /* The product's one engagement-rate definition, shared with the Posts tab, the
     Performance tab and the client report. This used to be an unweighted mean of
     Post.engagementRate over EVERY post, so the 18,602 imported posts that carry
     a default 0 (nobody ever fetched their engagement) dragged a real rate
     towards zero, and the same campaign read one way here and another two tabs
     across. null means no post on the campaign has been measured at all. */
  const engagement = rollupEngagement(campaign.posts);
  const avgEngagement = engagement.rate === null ? null : engagement.rate * 100;

  // Platform breakdown for analytics
  const platformStats = campaign.posts.reduce((acc, p) => {
    if (!acc[p.platform]) acc[p.platform] = { views: 0, likes: 0, posts: 0 };
    acc[p.platform].views += p.viewsCount;
    acc[p.platform].likes += p.likesCount;
    acc[p.platform].posts += 1;
    return acc;
  }, {} as Record<string, { views: number; likes: number; posts: number }>);

  const platformPieData = Object.entries(platformStats)
    .filter(([, stats]) => stats.views > 0)
    .map(([platform, stats]) => ({
      name: platform, value: stats.views, fill: platformColor(platform),
    }));

  // Per-creator breakdown for analytics
  const creatorStats = campaign.posts.reduce((acc, p) => {
    const name = (p as any).creator?.name ?? "Unknown";
    if (!acc[name]) acc[name] = { views: 0, likes: 0, posts: 0 };
    acc[name].views += p.viewsCount;
    acc[name].likes += p.likesCount;
    acc[name].posts += 1;
    return acc;
  }, {} as Record<string, { views: number; likes: number; posts: number }>);

  const creatorBarData = Object.entries(creatorStats).map(([name, stats]) => ({
    name: name.split(" ")[0], views: stats.views, likes: stats.likes,
  }));

  return (
    <div className="cc-page-content rsp-page">
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 24, color: "var(--cc-text-muted)" }}>
        <Link href="/campaigns" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--cc-text-muted)", textDecoration: "none" }}>
          <ArrowLeft size={16} /> Campaigns
        </Link>
        <ChevronRight size={12} />
        <span style={{ color: "var(--cc-text)" }}>{campaign.title}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)" }}>{campaign.title}</h1>
        <Badge variant={STATUS_BADGE[campaign.status] ?? "neutral"}>{campaign.status.replace(/_/g, " ")}</Badge>
        {campaign.campaignType && (
          <Badge variant={CAMPAIGN_TYPE_BADGE[campaign.campaignType] ?? "neutral"}>
            {CAMPAIGN_TYPE_LABELS[campaign.campaignType] ?? campaign.campaignType}
          </Badge>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32, fontSize: 14, color: "var(--cc-text-muted)", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Calendar size={14} />{formatDateAbs(campaign.createdAt)}</span>
        <span>·</span>
        <span>{roster.length} creators · {campaign._count.posts} posts</span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--cc-border)", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {tabsList.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: "10px 20px", fontSize: 14, fontWeight: 500,
              background: "none", border: "none", cursor: "pointer",
              borderBottom: activeTab === tab.value ? "2px solid var(--cc-primary)" : "2px solid transparent",
              color: activeTab === tab.value ? "var(--cc-primary)" : "var(--cc-text-muted)",
              display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span style={{ fontSize: 11, background: "var(--cc-bg)", borderRadius: 10, padding: "1px 7px", color: "var(--cc-text-muted)" }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {/* Performance */}
        {activeTab === "performance" && (
          <PerformanceTab campaignId={id} />
        )}

        {/* Overview */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* A figure nobody recorded is not shown at all: budget is optional to
                enter, and engagement is absent on most imported posts. Neither
                gets a zero or a dash standing in for the real number. */}
            <div className="rsp-grid-tiles">
              <MetricTile metric="totalViews" value={formatNumber(totalViews)} />
              {/* "Engagement rate", not "Avg engagement": the label described the
                  old mean-of-means and would now misname the figure below it. */}
              {avgEngagement !== null && (
                <MetricTile metric="engagementRate" value={avgEngagement.toFixed(2) + "%"} />
              )}
              <MetricTile metric="campaignCreators" value={String(roster.length)} />
              {campaign.budget != null && (
                /* `budget`, not `totalBudget`: this is one campaign's own cap.
                   totalBudget's help says "across all campaigns in this date
                   range", which is a different number and a range this page
                   does not have. */
                <MetricTile metric="budget" value={formatCompactCurrency(campaign.budget, campaign.currency)} />
              )}
            </div>

            <ActivityFeed campaignId={campaign.id} />

            <CampaignTagsCard
              campaignId={campaign.id}
              selected={(campaign.tagLinks ?? []).map((l) => l.tag)}
              onSaved={refreshCampaign}
            />

            {/* Brief */}
            <CreativeBriefCard
              campaignId={campaign.id}
              initialContent={campaign.brief?.content ?? ""}
            />

            {/* Notes */}
            {campaign.notes && (
              <Card variant="outlined" style={{ padding: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Notes</span>
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)", lineHeight: 1.6 }}>{campaign.notes}</p>
              </Card>
            )}

            {/* Team */}
            {campaign.teamMembers.length > 0 && (
              <Card variant="outlined" style={{ padding: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Team</span>
                <div style={{ display: "flex", gap: 12 }}>
                  {campaign.teamMembers.map(tm => (
                    <div key={tm.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "var(--cc-bg)" }}>
                      <Avatar name={tm.user.name} size="sm" />
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--cc-text)" }}>{tm.user.name}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Drafts Tab */}
        {activeTab === "drafts" && <DraftsTab campaignId={id} onChange={refreshCampaign} />}

        {activeTab === "documents" && <DocumentsTab campaignId={id} />}

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
              currency={campaign.currency}
              columnKeys={columnKeys}
              onColumnKeysChange={setColumnKeys}
              onAddCreator={() => setShowAddCreator(true)}
            />

            {/* Proposals, Invites & Negotiations */}
            <ProposalsSection campaignId={id} />
            <InvitesSection campaignId={id} />
            <NegotiationsSection campaignId={id} platformFeeMinor={(campaign as any).platformFeeMinor ?? 0} />
          </div>
        )}

        {/* Reviews Tab */}
        {activeTab === "reviews" && (
          <ReviewsSection campaignId={id} activations={campaign.activations} />
        )}

        {/* Analytics Tab */}
        {activeTab === "analytics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {campaign.marketplaceVisibility && campaign.marketplaceVisibility !== "PRIVATE" && (
              <div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>Marketplace</span>
                <MarketplaceAnalytics campaignId={id} currency={campaign.currency ?? "USD"} />
              </div>
            )}
            {(campaign.posts.length === 0 ? (
            <EmptyState icon={<TrendingUp size={32} color="var(--cc-text-subtle)" />} title="No analytics yet" description="Analytics will be available once posts are synced." />
          ) : (
            <div className="rsp-grid-2">
              {/* Platform breakdown */}
              <Card variant="outlined" style={{ padding: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>Views by Platform</span>
                {/* platformPieData drops every platform with no measured views,
                    so a campaign whose posts have never synced leaves it empty --
                    and an unguarded pie draws 240px of frame and legend around
                    nothing. The bar chart beside it has always had this guard. */}
                {platformPieData.length > 0 ? (
                  <div style={{ height: 240 }}>
                    <PlatformViewsPie data={platformPieData} formatNumber={formatNumber} />
                  </div>
                ) : (
                  <EmptyState icon={<TrendingUp size={32} color="var(--cc-text-subtle)" />} title="No views measured yet" />
                )}
              </Card>

              {/* Creator performance */}
              <Card variant="outlined" style={{ padding: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>Creator Performance</span>
                {creatorBarData.length > 0 ? (
                  <div style={{ height: 240 }}>
                    <CreatorPerformanceBar data={creatorBarData} formatNumber={formatNumber} />
                  </div>
                ) : (
                  <EmptyState icon={<BarChart3 size={32} color="var(--cc-text-subtle)" />} title="No creator data" />
                )}
              </Card>

              {/* Summary stats */}
              <Card variant="outlined" style={{ padding: 24, gridColumn: "1 / -1" }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>Performance Summary</span>
                <div className="rsp-grid-tiles">
                  <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-bg)" }}>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Total Views</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(totalViews)}</div>
                  </div>
                  <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-bg)" }}>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Total Likes</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(totalLikes)}</div>
                  </div>
                  <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-bg)" }}>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Engagement Rate</div>
                    {/* An em dash, not 0.0%: a campaign whose engagement nobody
                        has fetched has no rate, and printing one asserts a
                        measurement we never took. */}
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-primary)" }}>{avgEngagement === null ? "—" : avgEngagement.toFixed(2) + "%"}</div>
                  </div>
                  <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-bg)" }}>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Posts</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)" }}>{campaign.posts.length}</div>
                  </div>
                </div>
              </Card>
            </div>
          ))}
          </div>
        )}

        {/* Edit Tab */}
        {activeTab === "financials" && (
          <FinancialsTab
            campaignId={id}
            budget={campaign.budget ?? null}
            currency={campaign.currency ?? "USD"}
            notes={campaign.notes ?? null}
            creatorRateTotals={campaign.creatorRateTotals ?? null}
            profitTotal={campaign.profitTotal ?? null}
            financials={campaign.financials ?? null}
          />
        )}

        {activeTab === "edit" && (
          <div style={{ maxWidth: 640 }}>
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 20 }}>Edit Campaign</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label htmlFor="edit-campaign-title" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Campaign Title</label>
                  <input
                    id="edit-campaign-title"
                    type="text"
                    value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", boxSizing: "border-box" }}
                  />
                </div>
                <div className="rsp-grid-2">
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Status</label>
                    <Dropdown
                      ariaLabel="Status"
                      size="md"
                      fullWidth
                      align="left"
                      value={editForm.status}
                      onChange={v => setEditForm(f => ({ ...f, status: v }))}
                      options={["DRAFT", "PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"].map(s => ({
                        value: s,
                        label: s.replace(/_/g, " "),
                      }))}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Currency</label>
                    <Dropdown
                      ariaLabel="Currency"
                      size="md"
                      fullWidth
                      align="left"
                      value={editForm.currency}
                      onChange={v => setEditForm(f => ({ ...f, currency: v }))}
                      options={["USD", "EUR", "GBP", "INR"].map(c => ({ value: c, label: c }))}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="edit-budget" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>
                    Budget <span style={{ fontWeight: 500, color: "var(--cc-text-muted)" }}>(optional)</span>
                  </label>
                  <input
                    id="edit-budget"
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    placeholder="Leave blank if not tracking one"
                    value={editForm.budget}
                    onChange={e => setEditForm(f => ({ ...f, budget: e.target.value }))}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)" }}
                  />
                </div>
                <div>
                  <label htmlFor="edit-client" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Client</label>
                  {/* Searched rather than scrolled, as the reference does it. A
                      dropdown listing every client is fine at five and useless
                      at two hundred. Clearing the picker unsets the client. */}
                  <EntityPicker
                    id="edit-client"
                    endpoint="/api/clients"
                    placeholder="Search Clients"
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
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Notes</label>
                  <textarea
                    value={editForm.notes}
                    onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      padding: "9px 20px", borderRadius: 8, border: "none",
                      background: saving ? "var(--cc-border)" : "var(--cc-primary)",
                      color: "white", fontSize: 14, fontWeight: 600,
                      cursor: saving ? "not-allowed" : "pointer",
                    }}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>

            {/* ─── Marketplace section (Phase 2M) ─── */}
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24, marginTop: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Marketplace</h3>
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 20 }}>
                Control how creators discover and join this campaign. Rates are shown in {campaign.currency} and stored to the cent.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Visibility picker */}
                <div>
                  <label style={mktLabel}>Visibility</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {VISIBILITY_OPTIONS.map((opt) => {
                      const selected = mkt.marketplaceVisibility === opt.value;
                      return (
                        <div
                          key={opt.value}
                          onClick={() => setMkt((m) => ({ ...m, marketplaceVisibility: opt.value }))}
                          style={{
                            padding: 14, borderRadius: 10, cursor: "pointer",
                            border: `2px solid ${selected ? "var(--cc-primary)" : "var(--cc-border)"}`,
                            background: selected ? "var(--cc-primary-light)" : "var(--cc-card)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{opt.label}</span>
                            {selected && <Badge variant="accent">Selected</Badge>}
                          </div>
                          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 4 }}>{opt.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Invite code (INVITE_ONLY only) */}
                {mkt.marketplaceVisibility === "INVITE_ONLY" && (
                  <div>
                    <label style={mktLabel}>Invite code</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <code style={{
                        flex: 1, padding: "10px 14px", borderRadius: 10, fontSize: 15, letterSpacing: "0.08em",
                        border: "1px solid var(--cc-border)", background: "var(--cc-bg)", color: "var(--cc-text)", fontWeight: 700,
                      }}>
                        {campaign.inviteCode ?? "— saved on first save —"}
                      </code>
                      <button
                        onClick={handleRotateInviteCode}
                        disabled={rotatingCode || !campaign.inviteCode}
                        style={{
                          padding: "9px 16px", borderRadius: 8, border: "1px solid var(--cc-border)",
                          background: "var(--cc-card)", color: "var(--cc-text)", fontSize: 13, fontWeight: 600,
                          cursor: rotatingCode || !campaign.inviteCode ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                        }}
                      >
                        {rotatingCode ? "Rotating…" : "Regenerate"}
                      </button>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 6 }}>
                      Share this code with invited creators. A new code is generated when you first save; regenerating invalidates the old one.
                    </p>
                  </div>
                )}

                {/* Brief editor */}
                <div>
                  <label style={mktLabel}>Guidelines {mkt.marketplaceVisibility === "GLOBAL" && <span style={{ color: "var(--cc-danger)" }}>*</span>}</label>
                  <textarea
                    value={mkt.guidelines}
                    onChange={(e) => setMkt((m) => ({ ...m, guidelines: e.target.value }))}
                    rows={4}
                    placeholder="What should creators make? Tone, hooks, must-include beats…"
                    style={mktTextarea}
                  />
                </div>
                <div>
                  <label style={mktLabel}>Requirements</label>
                  <textarea
                    value={mkt.requirements}
                    onChange={(e) => setMkt((m) => ({ ...m, requirements: e.target.value }))}
                    rows={3}
                    placeholder="Minimum length, hashtags, disclosure, do's and don'ts…"
                    style={mktTextarea}
                  />
                </div>
                <div>
                  <label style={mktLabel}>Content assets URL</label>
                  <input
                    type="url"
                    value={mkt.contentAssetsUrl}
                    onChange={(e) => setMkt((m) => ({ ...m, contentAssetsUrl: e.target.value }))}
                    placeholder="https://drive.google.com/…"
                    style={mktInput}
                  />
                </div>

                {/* Per-platform rates (major units → stored minor) */}
                <div>
                  <label style={mktLabel}>
                    Rate per 1,000 verified views {mkt.marketplaceVisibility === "GLOBAL" && <span style={{ color: "var(--cc-danger)" }}>*</span>}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 10 }}>
                    Set a payout rate per platform (in {campaign.currency}). Leave blank to exclude a platform.
                  </p>
                  <div className="rsp-grid-2">
                    {MARKETPLACE_PLATFORMS.map((p) => (
                      <div key={p}>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 4 }}>{p}</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={mkt.rates[p] ?? ""}
                          onChange={(e) => setMkt((m) => ({ ...m, rates: { ...m.rates, [p]: e.target.value } }))}
                          placeholder="e.g. 1.50"
                          style={mktInput}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Deadline + auto-approve */}
                <div className="rsp-grid-2">
                  <div>
                    <label style={mktLabel}>Submission deadline</label>
                    <input
                      type="date"
                      value={mkt.submissionDeadline}
                      onChange={(e) => setMkt((m) => ({ ...m, submissionDeadline: e.target.value }))}
                      style={mktInput}
                    />
                  </div>
                  <div>
                    <label style={mktLabel}>Auto-approve after (hours)</label>
                    <input
                      type="number" min="1" max="720"
                      value={mkt.autoApproveHours}
                      onChange={(e) => setMkt((m) => ({ ...m, autoApproveHours: e.target.value }))}
                      placeholder="48"
                      style={mktInput}
                    />
                  </div>
                </div>

                {/* Public URL preview */}
                <div>
                  <label style={mktLabel}>Public page</label>
                  <div style={{ padding: "10px 14px", borderRadius: 10, border: "1px dashed var(--cc-border)", background: "var(--cc-bg)", fontSize: 13, color: "var(--cc-text-muted)" }}>
                    {campaign.publicSlug ? (
                      <span style={{ color: "var(--cc-text)" }}>/explore/{campaign.publicSlug}</span>
                    ) : mkt.marketplaceVisibility === "GLOBAL" ? (
                      <span>A public URL like <code>/explore/your-campaign-abc123</code> is created when you first publish.</span>
                    ) : (
                      <span>Set visibility to <strong>Public marketplace</strong> and save to generate a public URL.</span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={handleSaveMarketplace}
                    disabled={savingMkt}
                    style={{
                      padding: "9px 20px", borderRadius: 8, border: "none",
                      background: savingMkt ? "var(--cc-border)" : "var(--cc-primary)",
                      color: "white", fontSize: 14, fontWeight: 600,
                      cursor: savingMkt ? "not-allowed" : "pointer",
                    }}
                  >
                    {savingMkt ? "Saving…" : "Save Marketplace Settings"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {showAddCreator && (
        <Modal open onClose={() => { setShowAddCreator(false); setSelectedCreatorId(""); }} title="Add Creator to Campaign" size="md">
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            <CreatorSelect
              value={selectedCreatorId}
              onChange={(id) => setSelectedCreatorId(id)}
              excludeIds={campaign?.activations.map((a: Activation) => a.creator.id) ?? []}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => { setShowAddCreator(false); setSelectedCreatorId(""); }}
                style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--cc-border)", background: "var(--cc-card)", fontSize: 14, cursor: "pointer", color: "var(--cc-text)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddCreator}
                disabled={!selectedCreatorId || addingCreator}
                style={{
                  padding: "9px 16px", borderRadius: 8, border: "none",
                  background: selectedCreatorId && !addingCreator ? "var(--cc-primary)" : "var(--cc-border)",
                  color: "white", fontSize: 14, fontWeight: 600, cursor: selectedCreatorId ? "pointer" : "not-allowed",
                }}
              >
                {addingCreator ? "Adding..." : "Add Creator"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
