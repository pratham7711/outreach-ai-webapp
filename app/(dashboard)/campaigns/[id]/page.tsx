"use client";
import type { CSSProperties } from "react";
import { useState, useEffect, use } from "react";
import { motion } from "framer-motion";
import { Card, Badge, Button, StatCard, EmptyState, Avatar, Skeleton, Modal } from "@pratham7711/ui";
import PostsTab from "./PostsTab";
import PerformanceTab from "./PerformanceTab";
import DepositsSection from "./DepositsSection";
import PayoutRequestsSection from "./PayoutRequestsSection";
import InvitesSection from "./InvitesSection";
import NegotiationsSection from "./NegotiationsSection";
import ProposalsSection from "./ProposalsSection";
import ReviewsSection from "./ReviewsSection";
import {
  ArrowLeft, Eye, Heart, MessageCircle, Share2, TrendingUp, Users,
  Calendar, Play, ChevronRight, ExternalLink, DollarSign, UserPlus,
} from "lucide-react";
import Link from "next/link";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { toast } from "sonner";

type Tab = "performance" | "overview" | "posts" | "creators" | "reviews" | "analytics" | "financials" | "edit";

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
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

const ACTIVATION_STATUS: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  AWAITING_DRAFT: "warning",
  DRAFT_SUBMITTED: "neutral",
  APPROVED: "success",
  POSTED: "success",
  COMPLETE: "success",
  DECLINED: "danger",
};

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: "#000000",
  INSTAGRAM: "#E4405F",
  YOUTUBE: "#FF0000",
  TWITTER: "#1DA1F2",
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
  engagementRate: number;
  creator: { id: string; name: string };
};

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
  fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none", boxSizing: "border-box",
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
  financials: { spentAmount: number; totalBudget: number } | null;
  _count: { activations: number; posts: number };
};

function LoadingSkeleton() {
  return (
    <div className="cc-page-content" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Skeleton width="120px" height="16px" />
      <Skeleton width="300px" height="32px" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[1, 2, 3, 4].map(i => <Skeleton key={i} height="80px" borderRadius="10px" />)}
      </div>
      <Skeleton width="100%" height="300px" borderRadius="12px" />
    </div>
  );
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<Tab>("performance");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddCreator, setShowAddCreator] = useState(false);
  const [addingCreator, setAddingCreator] = useState(false);
  const [availableCreators, setAvailableCreators] = useState<{id: string; name: string; handle: string; platform: string}[]>([]);
  const [selectedCreatorId, setSelectedCreatorId] = useState("");
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "", status: "", budget: "", currency: "USD", notes: "", clientId: "",
  });
  const [saving, setSaving] = useState(false);

  // ─── Marketplace form state (major units in UI; converted to minor on save) ──
  const [mkt, setMkt] = useState({
    marketplaceVisibility: "PRIVATE" as "PRIVATE" | "GLOBAL" | "INVITE_ONLY",
    guidelines: "",
    requirements: "",
    contentAssetsUrl: "",
    rates: {} as Partial<Record<(typeof MARKETPLACE_PLATFORMS)[number], string>>,
    minPayoutMajor: "",
    budgetCapMajor: "",
    submissionDeadline: "",
    autoApproveHours: "48",
  });
  const [savingMkt, setSavingMkt] = useState(false);
  const [rotatingCode, setRotatingCode] = useState(false);

  useEffect(() => {
    fetch(`/api/campaigns/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { setCampaign(data && !data.error ? data : null); })
      .catch(() => setCampaign(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (campaign) {
      setEditForm({
        title: campaign.title,
        status: campaign.status,
        budget: campaign.budget ? String(campaign.budget) : "",
        currency: campaign.currency,
        notes: campaign.notes ?? "",
        clientId: campaign.clientId ?? "",
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
        minPayoutMajor: minorToMajor(campaign.minPayoutMinor),
        budgetCapMajor: minorToMajor(campaign.marketplaceBudgetCapMinor),
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

  const fetchAvailableCreators = async () => {
    const res = await fetch("/api/creators");
    if (res.ok) {
      const data = await res.json();
      const assignedIds = new Set(campaign?.activations.map((a: Activation) => a.creator.id) ?? []);
      setAvailableCreators((data.creators ?? data).filter((c: any) => !assignedIds.has(c.id)));
    }
  };

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
      };
      if (editForm.budget !== "") payload.budget = Number(editForm.budget);
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
        minPayoutMinor: majorToMinor(mkt.minPayoutMajor),
        marketplaceBudgetCapMinor: majorToMinor(mkt.budgetCapMajor),
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

  const tabsList: { label: string; value: Tab; count?: number }[] = [
    { label: "Performance", value: "performance" },
    { label: "Overview", value: "overview" },
    { label: "Posts", value: "posts", count: campaign?._count.posts },
    { label: "Creators", value: "creators", count: campaign?._count.activations },
    { label: "Reviews", value: "reviews" as Tab },
    { label: "Analytics", value: "analytics" },
    { label: "Financials", value: "financials" },
    { label: "Edit", value: "edit" as Tab },
  ];

  if (loading) return <LoadingSkeleton />;
  if (!campaign) return (
    <div className="cc-page-content">
      <EmptyState icon="📋" title="Campaign not found" description="This campaign may have been deleted." />
    </div>
  );

  const budget = campaign.budget ? Number(campaign.budget) : 0;
  const spent = campaign.financials ? Number(campaign.financials.spentAmount) : 0;
  const totalViews = campaign.posts.reduce((s, p) => s + p.viewsCount, 0);
  const totalLikes = campaign.posts.reduce((s, p) => s + p.likesCount, 0);
  const avgEngagement = campaign.posts.length > 0
    ? campaign.posts.reduce((s, p) => s + p.engagementRate, 0) / campaign.posts.length
    : 0;

  // Platform breakdown for analytics
  const platformStats = campaign.posts.reduce((acc, p) => {
    if (!acc[p.platform]) acc[p.platform] = { views: 0, likes: 0, posts: 0 };
    acc[p.platform].views += p.viewsCount;
    acc[p.platform].likes += p.likesCount;
    acc[p.platform].posts += 1;
    return acc;
  }, {} as Record<string, { views: number; likes: number; posts: number }>);

  const platformPieData = Object.entries(platformStats).map(([platform, stats]) => ({
    name: platform, value: stats.views, fill: PLATFORM_COLORS[platform] ?? "var(--cc-primary)",
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

  // Per-creator payout for financials
  const creatorPayouts = campaign.activations.map(act => ({
    name: act.creator.name,
    rate: act.creator.rate ? Number(act.creator.rate) : 0,
    status: act.status,
  }));

  const pieData = [
    { name: "Spent", value: spent },
    { name: "Remaining", value: Math.max(0, budget - spent) },
  ];

  return (
    <div className="cc-page-content">
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 24, color: "var(--cc-text-muted)" }}>
        <Link href="/campaigns" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--cc-text-muted)", textDecoration: "none" }}>
          <ArrowLeft size={16} /> Campaigns
        </Link>
        <ChevronRight size={12} />
        <span style={{ color: "var(--cc-text)" }}>{campaign.title}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)" }}>{campaign.title}</h1>
        <Badge variant={STATUS_BADGE[campaign.status] ?? "neutral"}>{campaign.status.replace(/_/g, " ")}</Badge>
        {campaign.campaignType && (
          <Badge variant={CAMPAIGN_TYPE_BADGE[campaign.campaignType] ?? "neutral"}>
            {CAMPAIGN_TYPE_LABELS[campaign.campaignType] ?? campaign.campaignType}
          </Badge>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32, fontSize: 14, color: "var(--cc-text-muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Calendar size={14} />{new Date(campaign.createdAt).toLocaleDateString()}</span>
        {budget > 0 && (
          <>
            <span>·</span>
            <span style={{ fontWeight: 700 }}>{formatCurrency(budget, campaign.currency)} budget</span>
          </>
        )}
        <span>·</span>
        <span>{campaign._count.activations} creators · {campaign._count.posts} posts</span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--cc-border)" }}>
        {tabsList.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: "10px 20px", fontSize: 14, fontWeight: 500,
              background: "none", border: "none", cursor: "pointer",
              borderBottom: activeTab === tab.value ? "2px solid var(--cc-primary)" : "2px solid transparent",
              color: activeTab === tab.value ? "var(--cc-primary)" : "var(--cc-text-muted)",
              display: "flex", alignItems: "center", gap: 6,
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              <StatCard value={formatNumber(totalViews)} label="Total Views" />
              <StatCard value={avgEngagement > 0 ? avgEngagement.toFixed(1) + "%" : "—"} label="Avg Engagement" />
              <StatCard value={String(campaign._count.activations)} label="Creators" />
              <StatCard value={budget > 0 ? `${Math.round((spent / budget) * 100)}%` : "—"} label="Budget Used" />
            </div>

            {/* Brief */}
            {campaign.brief && (
              <Card variant="outlined" style={{ padding: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Creative Brief</span>
                <div style={{ fontSize: 14, color: "var(--cc-text-muted)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                  {campaign.brief.content}
                </div>
              </Card>
            )}

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

        {/* Posts Tab */}
        {activeTab === "posts" && (
          <PostsTab
            campaignId={id}
            postApprovalMode={(campaign as any).postApprovalMode ?? "MANUAL"}
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
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => { setShowAddCreator(true); fetchAvailableCreators(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "var(--cc-primary)", color: "white", border: "none",
                  borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                <UserPlus size={14} /> Add Creator
              </button>
            </div>
            {campaign.activations.length === 0 ? (
              <EmptyState icon="👥" title="No creators yet" description="Add creators to this campaign to get started." />
            ) : (
              <Card variant="solid" noPadding>
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 100px",
                  gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
                }}>
                  {["Creator", "Platform", "Followers", "Rate", "Status"].map(h => (
                    <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                  ))}
                </div>
                <div className="cc-stagger">
                  {campaign.activations.map((act, i) => (
                    <Link
                      key={act.id}
                      href={`/creators/${act.creator.id}`}
                      style={{ textDecoration: "none", display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 100px", gap: 12, padding: "14px 24px", alignItems: "center", borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
                      className="cc-table-row"
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Avatar name={act.creator.name} size="sm" />
                        <div>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{act.creator.name}</p>
                          <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{act.creator.handle}</p>
                        </div>
                      </div>
                      <Badge variant="neutral">{act.creator.platform}</Badge>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(act.creator.followersCount)}</span>
                      <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{act.creator.rate ? formatCurrency(Number(act.creator.rate)) : "—"}</span>
                      <Badge variant={ACTIVATION_STATUS[act.status] ?? "neutral"} dot>{act.status.replace(/_/g, " ")}</Badge>
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {/* Proposals, Invites & Negotiations */}
            <ProposalsSection campaignId={id} />
            <InvitesSection campaignId={id} />
            <NegotiationsSection campaignId={id} />
          </div>
        )}

        {/* Reviews Tab */}
        {activeTab === "reviews" && (
          <ReviewsSection campaignId={id} activations={campaign.activations} />
        )}

        {/* Analytics Tab */}
        {activeTab === "analytics" && (
          campaign.posts.length === 0 ? (
            <EmptyState icon="📈" title="No analytics yet" description="Analytics will be available once posts are synced." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              {/* Platform breakdown */}
              <Card variant="outlined" style={{ padding: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>Views by Platform</span>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={platformPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={2} label={({ name, percent }: any) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                        {platformPieData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatNumber(Number(v ?? 0))} contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Creator performance */}
              <Card variant="outlined" style={{ padding: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>Creator Performance</span>
                {creatorBarData.length > 0 ? (
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={creatorBarData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                        <YAxis tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} tickFormatter={(v) => formatNumber(v)} />
                        <Tooltip formatter={(v: any) => formatNumber(Number(v ?? 0))} contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12 }} />
                        <Bar dataKey="views" fill="var(--cc-primary)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="likes" fill="#10B981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState icon="📊" title="No creator data" />
                )}
              </Card>

              {/* Summary stats */}
              <Card variant="outlined" style={{ padding: 24, gridColumn: "1 / -1" }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>Performance Summary</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                  <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-bg)" }}>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Total Views</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(totalViews)}</div>
                  </div>
                  <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-bg)" }}>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Total Likes</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(totalLikes)}</div>
                  </div>
                  <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-bg)" }}>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Avg Engagement</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-primary)" }}>{avgEngagement.toFixed(1)}%</div>
                  </div>
                  <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-bg)" }}>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Posts</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)" }}>{campaign.posts.length}</div>
                  </div>
                </div>
              </Card>
            </div>
          )
        )}

        {/* Financials Tab */}
        {activeTab === "financials" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <Card variant="outlined" style={{ padding: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Budget Overview</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(spent, campaign.currency)}</span>
                  {budget > 0 && <span style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>/ {formatCurrency(budget, campaign.currency)}</span>}
                </div>
                {budget > 0 && (
                  <>
                    <div style={{ height: 12, borderRadius: 6, marginBottom: 8, background: "var(--cc-bg)" }}>
                      <div style={{ height: "100%", borderRadius: 6, width: `${Math.min(100, (spent / budget) * 100)}%`, background: "linear-gradient(90deg, var(--cc-primary), #7C3AED)", transition: "width 0.5s" }} />
                    </div>
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      {Math.round((spent / budget) * 100)}% used · {formatCurrency(budget - spent, campaign.currency)} remaining
                    </span>
                  </>
                )}
              </Card>
              <Card variant="outlined" style={{ padding: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Budget Breakdown</span>
                {budget > 0 ? (
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value" paddingAngle={2}>
                          <Cell fill="var(--cc-primary)" />
                          <Cell fill="var(--cc-bg)" />
                        </Pie>
                        <Tooltip formatter={(v: any) => formatCurrency(Number(v ?? 0), campaign.currency)} contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState icon="💰" title="No budget set" />
                )}
              </Card>
            </div>

            {/* Per-creator payout breakdown */}
            {creatorPayouts.length > 0 && (
              <Card variant="solid" noPadding>
                <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Creator Rates</span>
                </div>
                {creatorPayouts.map((cp, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "14px 24px",
                      borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{cp.name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Badge variant={ACTIVATION_STATUS[cp.status] ?? "neutral"} dot>{cp.status.replace(/_/g, " ")}</Badge>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>
                        {cp.rate > 0 ? formatCurrency(cp.rate) : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </Card>
            )}

            {/* Deposits & Payout Requests Sections */}
            <DepositsSection campaignId={id} />
            <PayoutRequestsSection campaignId={id} />
          </div>
        )}

        {/* Edit Tab */}
        {activeTab === "edit" && (
          <div style={{ maxWidth: 640 }}>
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 20 }}>Edit Campaign</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Title</label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Status</label>
                    <select
                      value={editForm.status}
                      onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none" }}
                    >
                      {["DRAFT", "PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"].map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Currency</label>
                    <select
                      value={editForm.currency}
                      onChange={e => setEditForm(f => ({ ...f, currency: e.target.value }))}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none" }}
                    >
                      {["USD", "EUR", "GBP", "INR"].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Budget</label>
                  <input
                    type="number"
                    value={editForm.budget}
                    onChange={e => setEditForm(f => ({ ...f, budget: e.target.value }))}
                    placeholder="e.g. 25000"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Client</label>
                  <select
                    value={editForm.clientId}
                    onChange={e => setEditForm(f => ({ ...f, clientId: e.target.value }))}
                    onFocus={fetchClients}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none" }}
                  >
                    <option value="">No client</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Notes</label>
                  <textarea
                    value={editForm.notes}
                    onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
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
                            background: selected ? "rgba(91, 91, 214, 0.04)" : "var(--cc-card)",
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
                  <label style={mktLabel}>Guidelines {mkt.marketplaceVisibility === "GLOBAL" && <span style={{ color: "#DC2626" }}>*</span>}</label>
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
                    Rate per 1,000 verified views {mkt.marketplaceVisibility === "GLOBAL" && <span style={{ color: "#DC2626" }}>*</span>}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 10 }}>
                    Set a payout rate per platform (in {campaign.currency}). Leave blank to exclude a platform.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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

                {/* Payout thresholds + deadline + auto-approve */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={mktLabel}>Minimum payout ({campaign.currency})</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={mkt.minPayoutMajor}
                      onChange={(e) => setMkt((m) => ({ ...m, minPayoutMajor: e.target.value }))}
                      placeholder="e.g. 20"
                      style={mktInput}
                    />
                  </div>
                  <div>
                    <label style={mktLabel}>Budget cap ({campaign.currency})</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={mkt.budgetCapMajor}
                      onChange={(e) => setMkt((m) => ({ ...m, budgetCapMajor: e.target.value }))}
                      placeholder="e.g. 5000"
                      style={mktInput}
                    />
                  </div>
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
            {availableCreators.length === 0 ? (
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>No available creators to add. All creators are already assigned.</p>
            ) : (
              <select
                value={selectedCreatorId}
                onChange={(e) => setSelectedCreatorId(e.target.value)}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  border: "1px solid var(--cc-border)", fontSize: 14,
                  color: "var(--cc-text)", background: "var(--cc-card)",
                }}
              >
                <option value="">Select a creator...</option>
                {availableCreators.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (@{c.handle}) — {c.platform}
                  </option>
                ))}
              </select>
            )}
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
