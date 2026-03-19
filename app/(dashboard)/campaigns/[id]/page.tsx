"use client";
import { useState, useEffect, use } from "react";
import { motion } from "framer-motion";
import { Card, Badge, Button } from "@pratham7711/ui";
import {
  ArrowLeft, Eye, Heart, TrendingUp, Users,
  Calendar, Play, ChevronRight,
} from "lucide-react";
import Link from "next/link";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

type Tab = "overview" | "posts" | "creators" | "analytics" | "financials";

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

const STATUS_BADGE: Record<string, "success" | "warning" | "accent" | "neutral"> = {
  DRAFT: "neutral",
  PENDING: "warning",
  IN_PROGRESS: "accent",
  COMPLETE: "success",
  CANCELLED: "neutral",
};

const DUMMY_POSTS = [
  { id: 1, title: "Summer Vibes Reel", platform: "tiktok", views: 450000, likes: 32000, gradient: "from-blue-600 to-cyan-500" },
  { id: 2, title: "Behind the Scenes", platform: "instagram", views: 120000, likes: 8900, gradient: "from-pink-600 to-purple-500" },
  { id: 3, title: "Product Unboxing", platform: "tiktok", views: 890000, likes: 67000, gradient: "from-orange-500 to-red-500" },
  { id: 4, title: "Dance Challenge", platform: "tiktok", views: 2100000, likes: 180000, gradient: "from-green-500 to-teal-500" },
  { id: 5, title: "Day in My Life", platform: "instagram", views: 340000, likes: 21000, gradient: "from-purple-600 to-blue-500" },
  { id: 6, title: "Tutorial Series Ep1", platform: "youtube", views: 78000, likes: 5400, gradient: "from-red-500 to-orange-500" },
];

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: string | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
  teamMembers: { id: string; user: { id: string; name: string; avatarUrl: string | null } }[];
  activations: { id: string; status: string; creator: { id: string; name: string; handle: string; platform: string; followersCount: number } }[];
  financials: { spentAmount: string; totalBudget: string } | null;
  _count: { activations: number; posts: number };
};

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

  const tabsList: { label: string; value: Tab }[] = [
    { label: "Overview", value: "overview" },
    { label: "Posts", value: "posts" },
    { label: "Creators", value: "creators" },
    { label: "Analytics", value: "analytics" },
    { label: "Financials", value: "financials" },
  ];

  if (loading) return <div className="p-8" style={{ color: "var(--cc-text-muted)" }}>Loading...</div>;
  if (!campaign) return <div className="p-8" style={{ color: "var(--cc-text-muted)" }}>Campaign not found</div>;

  const budget = campaign.budget ? parseFloat(campaign.budget) : 0;
  const spent = campaign.financials ? parseFloat(campaign.financials.spentAmount) : 0;
  const pieData = [
    { name: "Spent", value: spent },
    { name: "Remaining", value: Math.max(0, budget - spent) },
  ];

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-6" style={{ color: "var(--cc-text-muted)" }}>
        <Link href="/campaigns" className="flex items-center gap-1" style={{ color: "var(--cc-text-muted)" }}>
          <ArrowLeft className="h-4 w-4" /> Campaigns
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span style={{ color: "var(--cc-text)" }}>{campaign.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>{campaign.title}</h1>
        <Badge variant={STATUS_BADGE[campaign.status] ?? "neutral"}>{campaign.status}</Badge>
      </div>
      <div className="flex items-center gap-4 mb-8" style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
        <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{new Date(campaign.createdAt).toLocaleDateString()}</span>
        {budget > 0 && (
          <>
            <span>·</span>
            <span style={{ fontWeight: 700 }}>{campaign.currency} {formatNumber(budget)} budget</span>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: "1px solid var(--cc-border)" }}>
        {tabsList.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className="px-5 py-3 text-sm font-medium transition-all"
            style={{
              borderBottom: activeTab === tab.value ? "2px solid var(--cc-primary)" : "2px solid transparent",
              color: activeTab === tab.value ? "var(--cc-primary)" : "var(--cc-text-muted)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Total Views", value: "—" },
                { label: "Engagement", value: "—" },
                { label: "Creators", value: String(campaign._count.activations) },
                { label: "Budget Used", value: budget > 0 ? `${Math.round((spent / budget) * 100)}%` : "—" },
              ].map(s => (
                <Card key={s.label} variant="glass" className="p-5" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: "var(--cc-text)" }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>{s.label}</div>
                </Card>
              ))}
            </div>
            <Card variant="glass" className="p-6" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Recent Activity</span>
              <div className="py-4 text-center" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No recent activity</div>
            </Card>
          </div>
        )}

        {activeTab === "posts" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {DUMMY_POSTS.map(post => (
              <Card key={post.id} variant="glass" className="overflow-hidden" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
                <div className={`h-48 bg-gradient-to-br ${post.gradient} flex items-center justify-center`}>
                  <div className="h-12 w-12 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <Play className="h-5 w-5 text-white ml-0.5" />
                  </div>
                </div>
                <div className="p-4">
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", marginBottom: 4 }}>{post.platform}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>{post.title}</div>
                  <div className="flex items-center gap-4 mt-2" style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{formatNumber(post.views)}</span>
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{formatNumber(post.likes)}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {activeTab === "creators" && (
          <Card variant="glass" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16, overflow: "hidden" }}>
            {campaign.activations.length === 0 ? (
              <div className="py-8 text-center" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No creators in this campaign yet</div>
            ) : campaign.activations.map((act, i) => {
              const initials = act.creator.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
              return (
                <div key={act.id} className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: i < campaign.activations.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">{initials}</div>
                  <div className="flex-1">
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{act.creator.name}</div>
                    <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{act.creator.handle} · {act.creator.platform}</div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "var(--cc-text)" }}>{formatNumber(act.creator.followersCount)}</div>
                  <Badge variant="neutral">{act.status}</Badge>
                </div>
              );
            })}
          </Card>
        )}

        {activeTab === "analytics" && (
          <div className="space-y-6">
            <Card variant="glass" className="p-6" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>Monthly Trend</span>
              <div className="py-8 text-center" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>Analytics data available once posts are synced</div>
            </Card>
          </div>
        )}

        {activeTab === "financials" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card variant="glass" className="p-6" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
                <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Budget Overview</span>
                <div className="flex items-center gap-2 mb-4">
                  <span style={{ fontSize: 28, fontWeight: 900, color: "var(--cc-text)" }}>{campaign.currency} {formatNumber(spent)}</span>
                  {budget > 0 && <span style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>/ {campaign.currency} {formatNumber(budget)}</span>}
                </div>
                {budget > 0 && (
                  <>
                    <div className="h-3 rounded-full mb-2" style={{ background: "#F3F4F6" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (spent / budget) * 100)}%`, background: "linear-gradient(90deg, #2563EB, #7C3AED)" }} />
                    </div>
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{Math.round((spent / budget) * 100)}% of budget used</span>
                  </>
                )}
              </Card>
              <Card variant="glass" className="p-6" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
                <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Budget Breakdown</span>
                {budget > 0 ? (
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value" paddingAngle={2}>
                          <Cell fill="#2563EB" />
                          <Cell fill="#F3F4F6" />
                        </Pie>
                        <Tooltip contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="py-8 text-center" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No budget set</div>
                )}
              </Card>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
