"use client";
import type { CSSProperties } from "react";
import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Card, Badge, EmptyState, Avatar, Skeleton, Modal } from "@pratham7711/ui";
import { Dropdown, MetricTile, EntityPicker, Button } from "@/components/ds";
import PostsTab from "./PostsTab";
import ActivityFeed from "./ActivityFeed";
import DraftsTab from "./DraftsTab";
import CreativeBriefCard from "./CreativeBriefCard";
import RosterTable, { ROSTER_COLUMNS, ROSTER_DEFAULT_COLUMNS, type RosterRow } from "./RosterTable";
import { readCampaignSection } from "@/lib/campaignSections";
import { SHOW_MONEY } from "@/lib/moneyUi";
import { useCampaignNavPublish } from "@/components/providers/CampaignNavProvider";
import { CampaignAudioSetup } from "@/components/campaigns/CampaignAudioSetup";
import { CAMPAIGN_HEADER_ACTIONS_ID } from "@/components/campaigns/CampaignHeaderActions";
import { CampaignShareButton } from "@/components/campaigns/CampaignShareButton";
import { NotFoundState } from "@/components/errors/NotFoundState";
import { useCampaignListHref } from "@/lib/campaigns/listReturn";
import InvitesSection from "./InvitesSection";
import {
  Eye, Heart, MessageCircle, Share2, TrendingUp, Users,
  Calendar, Play, ExternalLink, DollarSign,
  ClipboardList, BarChart3, Wallet, Trash2, AlertTriangle, X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateAbs, formatFull, formatFullCurrency, fitFigureSize } from "@/lib/format";
import { asOfCaption } from "@/lib/dataAge";
import { CreatorSelect } from "@/components/CreatorSelect";
import { TOP_CREATOR_BARS, type CampaignPostSummary } from "@/lib/campaigns/detailSummary";
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

/* The sections themselves live in lib/campaignSections, because the left rail
   renders the same list. They used to be a tab strip here; that strip is gone,
   and activeTab below takes its type from that module's reader. */

function formatNumber(num: number): string {
  return formatFull(num);
}

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

/* Title case, not the raw enum. MEASURED 2026-09-14 at desktop-1600: their
   campaign header's status reads `Complete`, and ours read `IN PROGRESS` --
   the same place, the same size and the same colour, shouting. The map is
   explicit rather than a generic de-snake, so a status whose reading is not
   just its enum spelled out has somewhere to say so. */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

const STATUS_BADGE: Record<string, "success" | "warning" | "accent" | "neutral"> = {
  DRAFT: "neutral",
  PENDING: "warning",
  IN_PROGRESS: "accent",
  COMPLETE: "success",
  CANCELLED: "neutral",
};

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
  display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6,
};
const mktInput: CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)",
  fontSize: "var(--cc-t-14)", color: "var(--cc-text)", background: "var(--cc-card)", boxSizing: "border-box",
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

  return (
    <Card variant="outlined" className="cc-overview-card">
      <span className="cc-panel-title" style={{ display: "block", marginBottom: 12 }}>
        Tags
      </span>

      {selected.length === 0 ? (
        <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)" }}>No tags added yet!</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {selected.map((s) => (
            <span
              key={s.id}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                borderRadius: 8, padding: "6px 8px 6px 12px", fontSize: "var(--cc-t-13)", color: "var(--cc-text)",
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
        <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
          {(defs ?? []).length === 0
            ? "No campaign tags defined yet — add them in Settings → General."
            : "All tags applied."}
        </p>
      )}

      {error && <p role="alert" style={{ marginTop: 8, fontSize: "var(--cc-t-12)", color: "var(--cc-danger)" }}>{error}</p>}
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
  /* The Overview tiles share one figure size, set by the longest of them. */
  const overviewFit = Math.max(
    totalViewsText.length,
    avgEngagement === null ? 0 : (avgEngagement.toFixed(2) + "%").length,
    String(roster.length).length,
    campaign.budget == null ? 0 : formatFullCurrency(campaign.budget, campaign.currency).length,
  );

  const platformPieData = summary.platforms
    .filter((stats) => stats.views > 0)
    .map((stats) => ({
      name: stats.platform, value: stats.views, fill: platformColor(stats.platform),
    }));

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
      {/* No breadcrumb here. The rail's "All campaigns" is the way back out now
          and the top bar carries the trail, so this row said the same thing a
          third time, in the same viewport. */}
      {/* Header. Not <PageHeader>: that stacks its title and puts everything
          else in a column, and this screen's status chips sit ON the title
          line. The shared markers are here so the parity harness measures the
          same landmarks it measures on every other screen -- without them the
          whole campaign shell reported UNRESOLVED and read as unmeasurable. */}
      <div className="cc-page-titlebar" data-region="page-header" data-parity="page.header-strip">
        {/* Title and status as ONE block, so a theme decides whether they sit
            on a line or stack. MEASURED 2026-09-14 at desktop-1600: their
            campaign header is two rows at the same x -- the title at y=38.3
            (20px/700, brand indigo) and the status alone under it at y=73.3
            (14px/400, pale indigo) -- while ours was one row with the
            status and type as pills to the right of the title. The wrapper is
            a flex row at base with the titlebar's own gap, so light and dark
            paint exactly what they painted before. */}
        <div className="cc-page-titleblock">
          <h1 className="cc-page-title" data-parity="page.title">{campaign.title}</h1>
          <div className="cc-page-titlemeta">
            <Badge variant={STATUS_BADGE[campaign.status] ?? "neutral"}>
              {STATUS_LABEL[campaign.status] ?? campaign.status.replace(/_/g, " ")}
            </Badge>
            {campaign.campaignType && (
              <Badge variant={CAMPAIGN_TYPE_BADGE[campaign.campaignType] ?? "neutral"}>
                {CAMPAIGN_TYPE_LABELS[campaign.campaignType] ?? campaign.campaignType}
              </Badge>
            )}
          </div>
        </div>
        {/* The section's own actions land here, through CampaignHeaderActions,
            after Share Campaign, which every section carries.
            `data-region="page-actions"` is
            what the parity harness looks for -- page.primary-action resolves
            through `[data-region="page-actions"] [data-cc-slot="primary"]`, the
            same selector every other page satisfies through PageHeader. */}
        <div
          className="cc-page-actions"
          data-region="page-actions"
          id={CAMPAIGN_HEADER_ACTIONS_ID}
        >
          {/* Share is the page's own child, so every section has it and it
              comes first: it is in the host when the page commits, before any
              section's portal mounts and appends after it, and it is never
              unmounted while the campaign is open, so it never moves to the
              end. That also means the row is no longer :empty on Overview,
              which is what puts Share on a phone's Overview at all. */}
          <CampaignShareButton campaignId={id} campaignTitle={campaign.title} />
        </div>
        {/* Close the campaign. MEASURED 2026-09-14 at desktop-1600 on the
            reference: a 16x16 grey glyph at 1548..1563.5 x 56.5..72, i.e. a
            28x28 hit area whose right edge is the header card's inner edge at
            1570. It is the reason their `Add Posts` starts at 1332 and ours
            started at 1370 -- the 38px offset the harness reported was this
            control, not a spacing error.

            A Link, not a button with router.back(): back() would return to
            whatever opened the campaign, which on a deep link is another site.
            Their close always lands on the campaign list, and so does this. The
            rail's "All campaigns" row is the same destination and stays -- they
            carry both too. */}
        <Link
          href={campaignListHref}
          className="cc-icon-btn cc-page-close"
          aria-label="Close campaign"
          title="Close campaign"
        >
          <X size={16} aria-hidden="true" />
        </Link>
      </div>
      <div className="cc-page-meta" data-region="page-meta">
        <span className="cc-page-meta-item"><Calendar size={14} />{formatDateAbs(campaign.createdAt)}</span>
        <span>·</span>
        <span>{roster.length} creators · {campaign._count.posts} posts</span>
      </div>

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
              <MetricTile fitTo={overviewFit} metric="totalViews" value={totalViewsText} footer={viewsNote} />
              {/* "Engagement rate", not "Avg engagement": the label described the
                  old mean-of-means and would now misname the figure below it. */}
              {avgEngagement !== null && (
                <MetricTile fitTo={overviewFit} metric="engagementRate" value={avgEngagement.toFixed(2) + "%"} />
              )}
              <MetricTile fitTo={overviewFit} metric="campaignCreators" value={String(roster.length)} />
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

            {/* Notes */}
            {campaign.notes && (
              <Card variant="outlined" className="cc-overview-card">
                <span className="cc-panel-title" style={{ display: "block", marginBottom: 12 }}>Notes</span>
                <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", lineHeight: 1.6 }}>{campaign.notes}</p>
              </Card>
            )}

            {/* Team */}
            {campaign.teamMembers.length > 0 && (
              <Card variant="outlined" className="cc-overview-card">
                <span className="cc-panel-title" style={{ display: "block", marginBottom: 12 }}>Team</span>
                <div style={{ display: "flex", gap: 12 }}>
                  {campaign.teamMembers.map(tm => (
                    <div key={tm.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "var(--cc-bg)" }}>
                      <Avatar name={tm.user.name} size="sm" />
                      <span style={{ fontSize: "var(--cc-t-13)", fontWeight: 500, color: "var(--cc-text)" }}>{tm.user.name}</span>
                    </div>
                  ))}
                </div>
              </Card>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {campaign.marketplaceVisibility && campaign.marketplaceVisibility !== "PRIVATE" && (
              <div>
                <span className="cc-panel-title" style={{ display: "block", marginBottom: 16 }}>Marketplace</span>
                <MarketplaceAnalytics campaignId={id} currency={campaign.currency ?? "USD"} />
              </div>
            )}
            {(summary.posts === 0 ? (
            <EmptyState icon={<TrendingUp size={32} color="var(--cc-text-subtle)" />} title="No analytics yet" description="Analytics will be available once posts are synced." />
          ) : (
            <div className="rsp-grid-2">
              {/* Summary stats FIRST. MEASURED at desktop-1600 on their campaign
                  analytics: the figures lead the screen -- `Post Performance`
                  at 243,148.3 over three 434x80 panels at y=182 -- and the
                  charts sit under them at y=307. Ours had the two charts at the
                  top and the numbers at the bottom of the grid, so nothing on
                  the page was where theirs is. The tiles carry classes for the
                  same reason the KPI strip on Posts does: their inline styles
                  were unreachable from the theme. */}
              <Card variant="outlined" className="cc-analytics-summary" style={{ gridColumn: "1 / -1" }}>
                <span className="cc-panel-title cc-analytics-summary-title" style={{ display: "block" }}>Performance Summary</span>
                <div className="cc-kpi-strip cc-kpi-quiet">
                  <div className="cc-kpi-chip" style={{ "--cc-kpi-fit": fitFigureSize(totalViewsText, 22) } as CSSProperties}>
                    <span className="cc-kpi-chip-label">Total Views</span>
                    <span className="cc-kpi-chip-value" title={viewsNote ?? totalViewsText}>{totalViewsText}</span>
                  </div>
                  {likesMeasured && (
                    <div className="cc-kpi-chip cc-kpi-chip-extra" style={{ "--cc-kpi-fit": fitFigureSize(formatNumber(totalLikes), 22) } as CSSProperties}>
                      <span className="cc-kpi-chip-label">Total Likes</span>
                      <span className="cc-kpi-chip-value" title={formatNumber(totalLikes)}>{formatNumber(totalLikes)}</span>
                    </div>
                  )}
                  {/* "Avg. Campaign Engagement Rate" is their wording, and it is
                      the more honest one: this is the campaign-wide rate from
                      rollupEngagement, not a per-post average. Both engagement
                      chips are left out, rather than printed as an em dash, for
                      a campaign whose engagement nobody has fetched. */}
                  {avgEngagement !== null && (
                    <div className="cc-kpi-chip">
                      <span className="cc-kpi-chip-label">Avg. Campaign Engagement Rate</span>
                      <span className="cc-kpi-chip-value cc-kpi-chip-value-accent">{avgEngagement.toFixed(2) + "%"}</span>
                    </div>
                  )}
                  {/* Their third panel. The figure is the numerator the rate
                      beside it is computed from, so the two always agree. */}
                  {engagement.engagements !== null && (
                    <div className="cc-kpi-chip">
                      <span className="cc-kpi-chip-label">Total Engagement</span>
                      <span className="cc-kpi-chip-value">{formatNumber(engagement.engagements)}</span>
                    </div>
                  )}
                  <div className="cc-kpi-chip cc-kpi-chip-extra">
                    <span className="cc-kpi-chip-label">Posts</span>
                    <span className="cc-kpi-chip-value">{summary.posts}</span>
                  </div>
                </div>
              </Card>

              {/* Platform breakdown */}
              <Card variant="outlined" style={{ padding: 24 }}>
                <span className="cc-panel-title cc-chart-title" style={{ display: "block", marginBottom: 16 }}>Views by Platform</span>
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
                <span className="cc-panel-title cc-chart-title" style={{ display: "block", marginBottom: creatorCount > TOP_CREATOR_BARS ? 4 : 16 }}>Creator Performance</span>
                {creatorCount > TOP_CREATOR_BARS && (
                  <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginBottom: 12 }}>
                    Top {TOP_CREATOR_BARS} of {creatorCount} creators, by views
                  </p>
                )}
                {creatorBarData.length > 0 ? (
                  <div style={{ height: 240 }}>
                    <CreatorPerformanceBar data={creatorBarData} formatNumber={formatNumber} />
                  </div>
                ) : (
                  <EmptyState icon={<BarChart3 size={32} color="var(--cc-text-subtle)" />} title="No creator data" />
                )}
              </Card>

            </div>
          ))}
          </div>
        )}

        {/* Edit Tab */}
        {activeTab === "edit" && (
          <div style={{ maxWidth: 640 }}>
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24 }}>
              <h3 style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)", marginBottom: 20 }}>Edit Campaign</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label htmlFor="edit-campaign-title" style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Campaign Title</label>
                  <input
                    id="edit-campaign-title"
                    type="text"
                    value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: "var(--cc-t-14)", color: "var(--cc-text)", background: "var(--cc-card)", boxSizing: "border-box" }}
                  />
                </div>
                <div className="rsp-grid-2">
                  <div>
                    <label style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Status</label>
                    <Dropdown
                      ariaLabel="Status"
                      size="md"
                      fullWidth
                      align="left"
                      value={editForm.status}
                      onChange={v => setEditForm(f => ({ ...f, status: v }))}
                      options={["PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"].map(s => ({
                        value: s,
                        label: s.replace(/_/g, " "),
                      }))}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Currency</label>
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
                  <label htmlFor="edit-budget" style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>
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
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: "var(--cc-t-14)", color: "var(--cc-text)", background: "var(--cc-card)" }}
                  />
                </div>
                <div>
                  <label htmlFor="edit-client" style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Client</label>
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
                  <label style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }} htmlFor="edit-notes">Notes</label>
                  <textarea
                    id="edit-notes"
                    value={editForm.notes}
                    onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: "var(--cc-t-14)", color: "var(--cc-text)", background: "var(--cc-card)", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      padding: "9px 20px", borderRadius: 8, border: "none",
                      background: saving ? "var(--cc-border)" : "var(--cc-primary)",
                      color: saving ? "white" : "var(--cc-on-primary)", fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)",
                      cursor: saving ? "not-allowed" : "pointer",
                    }}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>

            {/* The campaign's sound, added and changed here rather than from a
                button on the report: it is a property of the campaign, asked
                for when one is created and edited alongside the rest of it. */}
            <div style={{ marginTop: 24 }}>
              <CampaignAudioSetup campaignId={id} />
            </div>

            {/* ─── Marketplace section (Phase 2M) ─── */}
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24, marginTop: 24 }}>
              <h3 style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Marketplace</h3>
              <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", marginBottom: 20 }}>
                Control how creators discover and join this campaign.{SHOW_MONEY && <> Rates are shown in {campaign.currency} and stored to the cent.</>}
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Visibility picker */}
                <div>
                  <div id="mkt-visibility-label" style={mktLabel}>Visibility</div>
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
                  <div>
                    <label style={mktLabel}>Invite code</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <code style={{
                        flex: 1, padding: "10px 14px", borderRadius: 10, fontSize: "var(--cc-t-15)", letterSpacing: "0.08em",
                        border: "1px solid var(--cc-border)", background: "var(--cc-bg)", color: "var(--cc-text)", fontWeight: 700,
                      }}>
                        {campaign.inviteCode ?? "— saved on first save —"}
                      </code>
                      <button
                        onClick={handleRotateInviteCode}
                        disabled={rotatingCode || !campaign.inviteCode}
                        style={{
                          padding: "9px 16px", borderRadius: 8, border: "1px solid var(--cc-border)",
                          background: "var(--cc-card)", color: "var(--cc-text)", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)",
                          cursor: rotatingCode || !campaign.inviteCode ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                        }}
                      >
                        {rotatingCode ? "Rotating…" : "Regenerate"}
                      </button>
                    </div>
                    <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginTop: 6 }}>
                      Share this code with invited creators. A new code is generated when you first save; regenerating invalidates the old one.
                    </p>
                  </div>
                )}

                {/* Brief editor */}
                <div>
                  <label htmlFor="mkt-guidelines" style={mktLabel}>Guidelines {mkt.marketplaceVisibility === "GLOBAL" && <span style={{ color: "var(--cc-danger)" }}>*</span>}</label>
                  <textarea
                    id="mkt-guidelines"
                    value={mkt.guidelines}
                    onChange={(e) => setMkt((m) => ({ ...m, guidelines: e.target.value }))}
                    rows={4}
                    placeholder="What should creators make? Tone, hooks, must-include beats…"
                    style={mktTextarea}
                  />
                </div>
                <div>
                  <label htmlFor="mkt-requirements" style={mktLabel}>Requirements</label>
                  <textarea
                    id="mkt-requirements"
                    value={mkt.requirements}
                    onChange={(e) => setMkt((m) => ({ ...m, requirements: e.target.value }))}
                    rows={3}
                    placeholder="Minimum length, hashtags, disclosure, do's and don'ts…"
                    style={mktTextarea}
                  />
                </div>
                <div>
                  <label htmlFor="mkt-assets-url" style={mktLabel}>Content assets URL</label>
                  <input
                    id="mkt-assets-url"
                    type="url"
                    value={mkt.contentAssetsUrl}
                    onChange={(e) => setMkt((m) => ({ ...m, contentAssetsUrl: e.target.value }))}
                    placeholder="https://drive.google.com/…"
                    style={mktInput}
                  />
                </div>

                {/* Per-platform rates (major units → stored minor). Hidden while
                    SHOW_MONEY is off; see lib/moneyUi for why that is safe. */}
                {SHOW_MONEY && (
                  <div>
                    <label style={mktLabel}>
                      Rate per 1,000 verified views {mkt.marketplaceVisibility === "GLOBAL" && <span style={{ color: "var(--cc-danger)" }}>*</span>}
                    </label>
                    <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginBottom: 10 }}>
                      Set a payout rate per platform (in {campaign.currency}). Leave blank to exclude a platform.
                    </p>
                    <div className="rsp-grid-2">
                      {MARKETPLACE_PLATFORMS.map((p) => (
                        <div key={p}>
                          <label style={{ display: "block", fontSize: "var(--cc-t-12)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text-muted)", marginBottom: 4 }} htmlFor={`mkt-rate-${p}`}>{p}</label>
                          <input
                            id={`mkt-rate-${p}`}
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
                )}

                {/* Deadline + auto-approve */}
                <div className="rsp-grid-2">
                  <div>
                    <label htmlFor="mkt-deadline" style={mktLabel}>Submission deadline</label>
                    <input
                      id="mkt-deadline"
                      type="date"
                      value={mkt.submissionDeadline}
                      onChange={(e) => setMkt((m) => ({ ...m, submissionDeadline: e.target.value }))}
                      style={mktInput}
                    />
                  </div>
                  <div>
                    <label htmlFor="mkt-auto-approve" style={mktLabel}>Auto-approve after (hours)</label>
                    <input
                      id="mkt-auto-approve"
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
                  <div style={{ padding: "10px 14px", borderRadius: 10, border: "1px dashed var(--cc-border)", background: "var(--cc-bg)", fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
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
                      color: savingMkt ? "white" : "var(--cc-on-primary)", fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)",
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
                style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--cc-border)", background: "var(--cc-card)", fontSize: "var(--cc-t-14)", cursor: "pointer", color: "var(--cc-text)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddCreator}
                disabled={!selectedCreatorId || addingCreator}
                style={{
                  padding: "9px 16px", borderRadius: 8, border: "none",
                  background: selectedCreatorId && !addingCreator ? "var(--cc-primary)" : "var(--cc-border)",
                  color: selectedCreatorId && !addingCreator ? "var(--cc-on-primary)" : "white", fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", cursor: selectedCreatorId ? "pointer" : "not-allowed",
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
