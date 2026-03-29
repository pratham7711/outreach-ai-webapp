"use client";
import { useState, useEffect, use } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Eye, Heart, MessageCircle, Share2, Play, ChevronRight, ExternalLink, DollarSign,
} from "lucide-react";
import Link from "next/link";
import { Card, Badge, Avatar, EmptyState, Skeleton, StatCard } from "@pratham7711/ui";

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: "#000000",
  INSTAGRAM: "#E4405F",
  YOUTUBE: "#FF0000",
  TWITTER: "#1DA1F2",
};

const STATUS_VARIANT: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  PROCESSING: "neutral",
  SUCCESS: "success",
  FAILED: "danger",
  AWAITING_DRAFT: "warning",
  DRAFT_SUBMITTED: "neutral",
  APPROVED: "success",
  POSTED: "success",
  COMPLETE: "success",
  DECLINED: "danger",
};

type Tab = "profile" | "posts" | "campaigns" | "payouts";

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
  campaign: { id: string; title: string } | null;
};

type PayoutItem = {
  id: string;
  amount: number;
  status: string;
  currency: string;
  createdAt: string;
  campaign: { id: string; title: string } | null;
};

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  bio: string | null;
  contactEmail: string | null;
  followersCount: number;
  averageViews: number;
  rate: number | null;
  notes: string | null;
  activations: {
    id: string;
    status: string;
    deliverableDueDate: string | null;
    campaign: { id: string; title: string; status: string; budget: number | null; currency: string };
  }[];
  posts: Post[];
  payouts: PayoutItem[];
  _count: { activations: number; posts: number; payouts: number };
};

function LoadingSkeleton() {
  return (
    <div className="cc-page-content" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Skeleton width="120px" height="16px" />
      <Skeleton width="100%" height="220px" borderRadius="12px" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[1, 2, 3, 4].map(i => <Skeleton key={i} height="80px" borderRadius="10px" />)}
      </div>
      <Skeleton width="100%" height="300px" borderRadius="12px" />
    </div>
  );
}

export default function CreatorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/creators/${id}`)
      .then((r) => r.json())
      .then((data) => { setCreator(data.error ? null : data); })
      .finally(() => setLoading(false));
  }, [id]);

  const tabsList: { label: string; value: Tab; count?: number }[] = [
    { label: "Profile", value: "profile" },
    { label: "Posts", value: "posts", count: creator?._count.posts },
    { label: "Campaigns", value: "campaigns", count: creator?._count.activations },
    { label: "Payouts", value: "payouts", count: creator?._count.payouts },
  ];

  if (loading) return <LoadingSkeleton />;
  if (!creator) return (
    <div className="cc-page-content">
      <EmptyState icon="👤" title="Creator not found" description="This creator doesn't exist or has been removed." />
    </div>
  );

  const totalEarnings = creator.payouts
    .filter(p => p.status === "SUCCESS")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const avgEngagement = creator.posts.length > 0
    ? creator.posts.reduce((sum, p) => sum + p.engagementRate, 0) / creator.posts.length
    : 0;

  return (
    <div className="cc-page-content">
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 24, color: "var(--cc-text-muted)" }}>
        <Link href="/creators" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--cc-text-muted)", textDecoration: "none" }}>
          <ArrowLeft size={16} /> Creators
        </Link>
        <ChevronRight size={12} />
        <span style={{ color: "var(--cc-text)" }}>{creator.name}</span>
      </div>

      {/* Banner + Profile */}
      <Card variant="outlined" noPadding style={{ marginBottom: 32 }}>
        <div style={{ height: 96, background: `linear-gradient(to right, ${PLATFORM_COLORS[creator.platform] ?? "var(--cc-primary)"}22, ${PLATFORM_COLORS[creator.platform] ?? "var(--cc-primary)"}11)` }} />
        <div style={{ padding: "0 24px 24px", marginTop: -40 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
            <Avatar name={creator.name} size="lg" style={{ width: 80, height: 80, fontSize: 24, border: "4px solid var(--cc-card)" }} />
            <div style={{ flex: 1, paddingBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 2 }}>{creator.name}</h1>
                <Badge variant="neutral">{creator.platform}</Badge>
              </div>
              <div style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
                @{creator.handle}
                {creator.contactEmail && <> · {creator.contactEmail}</>}
              </div>
            </div>
            {creator.rate && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Rate</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-primary)" }}>{formatCurrency(Number(creator.rate))}</div>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 24 }}>
            <StatCard value={formatNumber(creator.followersCount)} label="Followers" />
            <StatCard value={String(creator._count.activations)} label="Campaigns" />
            <StatCard value={totalEarnings > 0 ? formatCurrency(totalEarnings) : "—"} label="Total Earnings" />
            <StatCard value={avgEngagement > 0 ? avgEngagement.toFixed(1) + "%" : "—"} label="Avg Engagement" />
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--cc-border)" }}>
        {tabsList.map(tab => (
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
        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <Card variant="outlined" style={{ padding: 24 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>About</span>
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", lineHeight: 1.6 }}>
                {creator.bio ?? `${creator.platform} content creator. Open to brand partnerships and collaborations.`}
              </p>
              {creator.contactEmail && (
                <div style={{ marginTop: 16, fontSize: 13, color: "var(--cc-text-muted)" }}>
                  <strong>Email:</strong> {creator.contactEmail}
                </div>
              )}
            </Card>
            <Card variant="outlined" style={{ padding: 24 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Notes</span>
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", lineHeight: 1.6 }}>
                {creator.notes ?? "No notes added yet."}
              </p>
            </Card>
          </div>
        )}

        {/* Posts Tab */}
        {activeTab === "posts" && (
          creator.posts.length === 0 ? (
            <EmptyState icon="📹" title="No posts yet" description="Posts will appear here when synced from social platforms." />
          ) : (
            <Card variant="solid" noPadding>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 120px 100px 80px 80px 80px 80px",
                gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
              }}>
                {["Post", "Campaign", "Views", "Likes", "Comments", "Shares", "Eng %"].map(h => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                ))}
              </div>
              <div className="cc-stagger">
                {creator.posts.map((post, i) => (
                  <a
                    key={post.id}
                    href={post.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: "none", display: "grid", gridTemplateColumns: "1fr 120px 100px 80px 80px 80px 80px", gap: 12, padding: "14px 24px", alignItems: "center", borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
                    className="cc-table-row"
                  >
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {post.caption?.slice(0, 60) ?? "Untitled Post"} <ExternalLink size={11} style={{ opacity: 0.4 }} />
                      </p>
                      <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{new Date(post.postedAt).toLocaleDateString()}</p>
                    </div>
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{post.campaign?.title ?? "—"}</span>
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

        {/* Campaigns Tab */}
        {activeTab === "campaigns" && (
          creator.activations.length === 0 ? (
            <EmptyState icon="📋" title="No campaigns yet" description="This creator has not been assigned to any campaigns." />
          ) : (
            <div className="cc-stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {creator.activations.map(act => (
                <Link key={act.id} href={`/campaigns/${act.campaign.id}`} style={{ textDecoration: "none" }}>
                  <Card variant="outlined" style={{ padding: 20 }} clickable>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{act.campaign.title}</div>
                        <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2 }}>
                          {act.deliverableDueDate ? `Due: ${new Date(act.deliverableDueDate).toLocaleDateString()}` : "No due date"}
                        </div>
                      </div>
                      <Badge variant={STATUS_VARIANT[act.status] ?? "neutral"} dot>{act.status.replace(/_/g, " ")}</Badge>
                      {act.campaign.budget && (
                        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>
                          {formatCurrency(Number(act.campaign.budget), act.campaign.currency)}
                        </span>
                      )}
                      <ChevronRight size={16} style={{ color: "var(--cc-text-subtle)" }} />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )
        )}

        {/* Payouts Tab */}
        {activeTab === "payouts" && (
          creator.payouts.length === 0 ? (
            <EmptyState icon="💸" title="No payouts yet" description="Payment history will appear here." />
          ) : (
            <Card variant="solid" noPadding>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 120px 100px 100px",
                gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
              }}>
                {["Campaign", "Amount", "Status", "Date"].map(h => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                ))}
              </div>
              <div className="cc-stagger">
                {creator.payouts.map((p, i) => (
                  <div
                    key={p.id}
                    className="cc-table-row"
                    style={{
                      display: "grid", gridTemplateColumns: "1fr 120px 100px 100px",
                      gap: 12, padding: "14px 24px", alignItems: "center",
                      borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                    }}
                  >
                    <span style={{ fontSize: 14, color: "var(--cc-text)" }}>{p.campaign?.title ?? "—"}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(Number(p.amount), p.currency)}</span>
                    <Badge variant={STATUS_VARIANT[p.status] ?? "neutral"} dot>{p.status}</Badge>
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{new Date(p.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </Card>
          )
        )}
      </motion.div>
    </div>
  );
}
