"use client";
import { useState, useEffect, use } from "react";
import { motion } from "framer-motion";
import { Card, Badge, Button, StatCard, EmptyState, Avatar, Skeleton } from "@pratham7711/ui";
import {
  ArrowLeft, Eye, Heart, MessageCircle, Share2, TrendingUp, Users,
  Calendar, Play, ChevronRight, ExternalLink, DollarSign,
} from "lucide-react";
import Link from "next/link";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

type Tab = "overview" | "posts" | "creators" | "analytics" | "financials";

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

type Campaign = {
  id: string;
  title: string;
  status: string;
  campaignType?: string;
  typeConfig?: Record<string, unknown> | null;
  budget: number | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
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
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/campaigns/${id}`)
      .then((r) => r.json())
      .then((data) => { setCampaign(data.error ? null : data); })
      .finally(() => setLoading(false));
  }, [id]);

  const tabsList: { label: string; value: Tab; count?: number }[] = [
    { label: "Overview", value: "overview" },
    { label: "Posts", value: "posts", count: campaign?._count.posts },
    { label: "Creators", value: "creators", count: campaign?._count.activations },
    { label: "Analytics", value: "analytics" },
    { label: "Financials", value: "financials" },
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

        {/* Posts Tab — Real Data */}
        {activeTab === "posts" && (
          campaign.posts.length === 0 ? (
            <EmptyState icon="📹" title="No posts yet" description="Posts will appear here when synced from social platforms." />
          ) : (
            <Card variant="solid" noPadding>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 100px 90px 80px 80px 80px 70px",
                gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
              }}>
                {["Post", "Platform", "Views", "Likes", "Comments", "Shares", "Eng %"].map(h => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                ))}
              </div>
              <div className="cc-stagger">
                {campaign.posts.map((post, i) => (
                  <a
                    key={post.id}
                    href={post.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      textDecoration: "none", display: "grid",
                      gridTemplateColumns: "1fr 100px 90px 80px 80px 80px 70px",
                      gap: 12, padding: "14px 24px", alignItems: "center",
                      borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                    }}
                    className="cc-table-row"
                  >
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {post.caption?.slice(0, 50) ?? "Untitled"} <ExternalLink size={11} style={{ opacity: 0.4 }} />
                      </p>
                      <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{new Date(post.postedAt).toLocaleDateString()}</p>
                    </div>
                    <Badge variant="neutral" style={{ fontSize: 11 }}>{post.platform}</Badge>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(post.viewsCount)}</span>
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(post.likesCount)}</span>
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(post.commentsCount)}</span>
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(post.sharesCount)}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-primary)" }}>{post.engagementRate.toFixed(1)}%</span>
                  </a>
                ))}
              </div>
            </Card>
          )
        )}

        {/* Creators Tab */}
        {activeTab === "creators" && (
          campaign.activations.length === 0 ? (
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
          )
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
          </div>
        )}
      </motion.div>
    </div>
  );
}
