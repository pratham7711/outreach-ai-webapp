"use client";
import { useState, useEffect, use } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Eye, Heart, MessageCircle, Share2, Play, ChevronRight, ExternalLink, DollarSign, Pencil, Plus, Trash2, Users,
} from "lucide-react";
import Link from "next/link";
import { Card, Badge, Avatar, EmptyState, Skeleton, StatCard, Modal, Input } from "@pratham7711/ui";

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

type Tab = "profile" | "posts" | "campaigns" | "payouts" | "social";

type SocialAccount = {
  id: string;
  platform: string;
  handle: string;
  followersCount: number;
  avgViews: number;
  tokenExpiry: string | null;
  createdAt: string;
  updatedAt: string;
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

const responsiveStyles = `
  .cd-stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-top: 24px;
  }
  .cd-profile-header {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;
  }
  .cd-profile-info { flex: 1; padding-bottom: 4px; min-width: 180px; }
  .cd-profile-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .cd-banner-inner { padding: 0 16px 20px; margin-top: -32px; }
  .cd-tabs-bar {
    display: flex;
    gap: 4px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--cc-border);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .cd-tabs-bar::-webkit-scrollbar { display: none; }
  .cd-tabs-bar button { white-space: nowrap; flex-shrink: 0; }
  .cd-profile-cards {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .cd-posts-table-header,
  .cd-posts-table-row {
    display: none;
  }
  .cd-post-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid var(--cc-border);
    text-decoration: none;
  }
  .cd-post-card:first-child { border-top: none; }
  .cd-post-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .cd-post-stat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--cc-text-muted);
  }
  .cd-payouts-header,
  .cd-payout-row {
    display: none;
  }
  .cd-payout-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid var(--cc-border);
  }
  .cd-payout-card:first-child { border-top: none; }
  .cd-campaign-row-budget { display: none; }
  .cd-campaign-row-chevron { display: none; }
  .cd-social-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 480px) {
    .cd-social-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (min-width: 640px) {
    .cd-stats-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .cd-banner-inner { padding: 0 24px 24px; margin-top: -40px; }
    .cd-profile-cards { grid-template-columns: 1fr 1fr; gap: 24px; }
    .cd-campaign-row-budget { display: block; }
    .cd-campaign-row-chevron { display: block; }
    .cd-payouts-header {
      display: grid;
      grid-template-columns: 1fr 120px 100px 100px;
      gap: 12px;
      padding: 12px 24px;
      border-bottom: 1px solid var(--cc-border);
      background: var(--cc-bg);
    }
    .cd-payout-row {
      display: grid;
      grid-template-columns: 1fr 120px 100px 100px;
      gap: 12px;
      padding: 14px 24px;
      align-items: center;
    }
    .cd-payout-card { display: none; }
  }

  @media (min-width: 768px) {
    .cd-stats-grid { grid-template-columns: repeat(4, 1fr); }
  }

  @media (min-width: 900px) {
    .cd-social-grid { grid-template-columns: repeat(3, 1fr); }
  }

  @media (min-width: 1024px) {
    .cd-posts-table-header {
      display: grid;
      grid-template-columns: 1fr 120px 100px 80px 80px 80px 80px;
      gap: 12px;
      padding: 12px 24px;
      border-bottom: 1px solid var(--cc-border);
      background: var(--cc-bg);
    }
    .cd-posts-table-row {
      display: grid;
      grid-template-columns: 1fr 120px 100px 80px 80px 80px 80px;
      gap: 12px;
      padding: 14px 24px;
      align-items: center;
      text-decoration: none;
    }
    .cd-post-card { display: none; }
  }
`;

function LoadingSkeleton() {
  return (
    <div className="cc-page-content" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Skeleton width="120px" height="16px" />
      <Skeleton width="100%" height="220px" borderRadius="12px" />
      <div className="cd-stats-grid">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} height="80px" borderRadius="10px" />)}
      </div>
      <Skeleton width="100%" height="300px" borderRadius="12px" />
      <style>{responsiveStyles}</style>
    </div>
  );
}

function EditCreatorModal({ open, onClose, creator, onSaved }: { open: boolean; onClose: () => void; creator: Creator; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: creator.name,
    handle: creator.handle,
    platform: creator.platform,
    bio: creator.bio ?? "",
    contactEmail: creator.contactEmail ?? "",
    rate: creator.rate != null ? String(creator.rate) : "",
    notes: creator.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: creator.name,
        handle: creator.handle,
        platform: creator.platform,
        bio: creator.bio ?? "",
        contactEmail: creator.contactEmail ?? "",
        rate: creator.rate != null ? String(creator.rate) : "",
        notes: creator.notes ?? "",
      });
    }
  }, [open, creator]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    const payload: Record<string, unknown> = {};
    if (form.name !== creator.name) payload.name = form.name;
    if (form.handle !== creator.handle) payload.handle = form.handle;
    if (form.platform !== creator.platform) payload.platform = form.platform;
    if (form.bio !== (creator.bio ?? "")) payload.bio = form.bio || null;
    if (form.contactEmail !== (creator.contactEmail ?? "")) payload.contactEmail = form.contactEmail || null;
    const rateNum = form.rate ? Number(form.rate) : null;
    if (rateNum !== (creator.rate != null ? Number(creator.rate) : null)) payload.rate = rateNum;
    if (form.notes !== (creator.notes ?? "")) payload.notes = form.notes || null;

    try {
      const res = await fetch(`/api/creators/${creator.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const textareaStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid var(--cc-border)",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: "var(--cc-text)",
    resize: "vertical",
    minHeight: 80,
    fontFamily: "inherit",
    background: "var(--cc-card)",
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Creator">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 4 }}>
        <Input label="Name" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("name", e.target.value)} required />
        <Input label="Handle" value={form.handle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("handle", e.target.value)} required />
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Platform</label>
          <select
            value={form.platform}
            onChange={e => set("platform", e.target.value)}
            style={{
              width: "100%",
              border: "1px solid var(--cc-border)",
              borderRadius: 8,
              padding: "9px 10px",
              fontSize: 14,
              color: "var(--cc-text)",
              background: "var(--cc-card)",
              cursor: "pointer",
            }}
          >
            {["INSTAGRAM", "TIKTOK", "YOUTUBE", "TWITTER"].map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Bio</label>
          <textarea value={form.bio} onChange={e => set("bio", e.target.value)} style={textareaStyle} />
        </div>
        <Input label="Contact Email" type="email" value={form.contactEmail} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("contactEmail", e.target.value)} />
        <Input label="Rate per Post (USD)" type="number" value={form.rate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("rate", e.target.value)} />
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Notes</label>
          <textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={textareaStyle} />
        </div>
        <button
          type="submit"
          disabled={saving}
          style={{
            background: "var(--cc-primary)",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </Modal>
  );
}

export default function CreatorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [socialLoading, setSocialLoading] = useState(false);
  const [showAddSocial, setShowAddSocial] = useState(false);
  const [addSocialForm, setAddSocialForm] = useState({ platform: "INSTAGRAM", handle: "", followersCount: "", avgViews: "" });
  const [addingSocial, setAddingSocial] = useState(false);

  const fetchSocialAccounts = () => {
    setSocialLoading(true);
    fetch(`/api/creators/${id}/social-accounts`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setSocialAccounts(data); })
      .finally(() => setSocialLoading(false));
  };

  const handleAddSocial = async () => {
    if (addingSocial || !addSocialForm.handle.trim()) return;
    setAddingSocial(true);
    try {
      const res = await fetch(`/api/creators/${id}/social-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: addSocialForm.platform,
          handle: addSocialForm.handle.trim(),
          followersCount: addSocialForm.followersCount ? Number(addSocialForm.followersCount) : 0,
          avgViews: addSocialForm.avgViews ? Number(addSocialForm.avgViews) : 0,
        }),
      });
      if (res.ok) {
        setShowAddSocial(false);
        setAddSocialForm({ platform: "INSTAGRAM", handle: "", followersCount: "", avgViews: "" });
        fetchSocialAccounts();
      }
    } finally {
      setAddingSocial(false);
    }
  };

  const handleRemoveSocial = async (accountId: string) => {
    const res = await fetch(`/api/creators/${id}/social-accounts?accountId=${accountId}`, { method: "DELETE" });
    if (res.ok) fetchSocialAccounts();
  };

  const refreshCreator = () => {
    fetch(`/api/creators/${id}`)
      .then((r) => r.json())
      .then((data) => { if (!data.error) setCreator(data); });
  };

  useEffect(() => {
    fetch(`/api/creators/${id}`)
      .then((r) => r.json())
      .then((data) => { setCreator(data.error ? null : data); })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (activeTab === "social") fetchSocialAccounts();
  }, [activeTab]);

  const tabsList: { label: string; value: Tab; count?: number }[] = [
    { label: "Profile", value: "profile" },
    { label: "Posts", value: "posts", count: creator?._count.posts },
    { label: "Campaigns", value: "campaigns", count: creator?._count.activations },
    { label: "Payouts", value: "payouts", count: creator?._count.payouts },
    { label: "Social Accounts", value: "social" },
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
      <style>{responsiveStyles}</style>

      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 24, color: "var(--cc-text-muted)" }}>
        <Link href="/creators" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--cc-text-muted)", textDecoration: "none" }}>
          <ArrowLeft size={16} /> Creators
        </Link>
        <ChevronRight size={12} />
        <span style={{ color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creator.name}</span>
      </div>

      {/* Banner + Profile */}
      <Card variant="outlined" noPadding style={{ marginBottom: 24 }}>
        <div style={{ height: 80, background: `linear-gradient(to right, ${PLATFORM_COLORS[creator.platform] ?? "var(--cc-primary)"}22, ${PLATFORM_COLORS[creator.platform] ?? "var(--cc-primary)"}11)` }} />
        <div className="cd-banner-inner">
          <div className="cd-profile-header">
            <Avatar name={creator.name} size="lg" style={{ width: 72, height: 72, fontSize: 22, border: "4px solid var(--cc-card)", flexShrink: 0 }} />
            <div className="cd-profile-info">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{creator.name}</h1>
                <Badge variant="neutral">{creator.platform}</Badge>
              </div>
              <div style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 2 }}>
                {creator.handle.startsWith("@") ? creator.handle : `@${creator.handle}`}
                {creator.contactEmail && <> · {creator.contactEmail}</>}
              </div>
            </div>
            <div className="cd-profile-actions">
              {creator.rate && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Rate</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-primary)" }}>{formatCurrency(Number(creator.rate))}</div>
                </div>
              )}
              <button
                onClick={() => setEditOpen(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", fontSize: 13, fontWeight: 600,
                  color: "var(--cc-primary)", background: "white",
                  border: "1.5px solid var(--cc-primary)", borderRadius: 8, cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Pencil size={14} /> Edit
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="cd-stats-grid">
            <StatCard value={formatNumber(creator.followersCount)} label="Followers" />
            <StatCard value={String(creator._count.activations)} label="Campaigns" />
            <StatCard value={totalEarnings > 0 ? "$" + formatNumber(totalEarnings) : "—"} label="Total Earnings" />
            <StatCard value={avgEngagement > 0 ? avgEngagement.toFixed(1) + "%" : "—"} label="Avg Engagement" />
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="cd-tabs-bar">
        {tabsList.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: "10px 16px", fontSize: 14, fontWeight: 500,
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
          <div className="cd-profile-cards">
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
              {/* Desktop table header */}
              <div className="cd-posts-table-header">
                {["Post", "Campaign", "Views", "Likes", "Comments", "Shares", "Eng %"].map(h => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                ))}
              </div>
              <div className="cc-stagger">
                {creator.posts.map((post, i) => (
                  <div key={post.id}>
                    {/* Desktop row */}
                    <a
                      href={post.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cd-posts-table-row cc-table-row"
                      style={{ borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
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
                    {/* Mobile card */}
                    <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="cd-post-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
                            {post.caption?.slice(0, 50) ?? "Untitled Post"} <ExternalLink size={11} style={{ opacity: 0.4 }} />
                          </p>
                          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "2px 0 0" }}>
                            {post.campaign?.title ?? "—"} · {new Date(post.postedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-primary)", flexShrink: 0 }}>{post.engagementRate.toFixed(1)}%</span>
                      </div>
                      <div className="cd-post-stats">
                        <span className="cd-post-stat"><Eye size={13} /> {formatNumber(post.viewsCount)}</span>
                        <span className="cd-post-stat"><Heart size={13} /> {formatNumber(post.likesCount)}</span>
                        <span className="cd-post-stat"><MessageCircle size={13} /> {formatNumber(post.commentsCount)}</span>
                        <span className="cd-post-stat"><Share2 size={13} /> {formatNumber(post.sharesCount)}</span>
                      </div>
                    </a>
                  </div>
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
                  <Card variant="outlined" style={{ padding: "16px 20px" }} clickable>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{act.campaign.title}</div>
                        <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2 }}>
                          {act.deliverableDueDate ? `Due: ${new Date(act.deliverableDueDate).toLocaleDateString()}` : "No due date"}
                        </div>
                      </div>
                      <Badge variant={STATUS_VARIANT[act.status] ?? "neutral"} dot>{act.status.replace(/_/g, " ")}</Badge>
                      {act.campaign.budget && (
                        <span className="cd-campaign-row-budget" style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>
                          {formatCurrency(Number(act.campaign.budget), act.campaign.currency)}
                        </span>
                      )}
                      <span className="cd-campaign-row-chevron">
                        <ChevronRight size={16} style={{ color: "var(--cc-text-subtle)" }} />
                      </span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )
        )}

        {/* Social Accounts Tab */}
        {activeTab === "social" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)" }}>Connected Accounts</span>
              <button
                onClick={() => setShowAddSocial(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "var(--cc-primary)", color: "white", border: "none",
                  borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                <Plus size={14} /> Add Account
              </button>
            </div>

            {/* Add form */}
            {showAddSocial && (
              <Card variant="outlined" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--cc-text)", marginBottom: 4 }}>Platform</label>
                      <select
                        value={addSocialForm.platform}
                        onChange={e => setAddSocialForm(prev => ({ ...prev, platform: e.target.value }))}
                        style={{
                          width: "100%", border: "1px solid var(--cc-border)", borderRadius: 8,
                          padding: "8px 10px", fontSize: 13, color: "var(--cc-text)", background: "var(--cc-card)",
                        }}
                      >
                        {["INSTAGRAM", "TIKTOK", "YOUTUBE", "TWITTER"].map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <Input
                      label="Handle"
                      value={addSocialForm.handle}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddSocialForm(prev => ({ ...prev, handle: e.target.value }))}
                      placeholder="@username"
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Input
                      label="Followers"
                      type="number"
                      value={addSocialForm.followersCount}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddSocialForm(prev => ({ ...prev, followersCount: e.target.value }))}
                      placeholder="0"
                    />
                    <Input
                      label="Avg Views"
                      type="number"
                      value={addSocialForm.avgViews}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddSocialForm(prev => ({ ...prev, avgViews: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setShowAddSocial(false)}
                      style={{
                        padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                        background: "var(--cc-card)", color: "var(--cc-text-muted)",
                        border: "1px solid var(--cc-border)", borderRadius: 8,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddSocial}
                      disabled={addingSocial || !addSocialForm.handle.trim()}
                      style={{
                        padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: addingSocial ? "not-allowed" : "pointer",
                        background: "var(--cc-primary)", color: "white", border: "none", borderRadius: 8,
                        opacity: addingSocial || !addSocialForm.handle.trim() ? 0.5 : 1,
                      }}
                    >
                      {addingSocial ? "Adding..." : "Add"}
                    </button>
                  </div>
                </div>
              </Card>
            )}

            {socialLoading ? (
              <div className="cd-social-grid">
                {[1, 2, 3].map(i => <Skeleton key={i} height="140px" borderRadius="12px" />)}
              </div>
            ) : socialAccounts.length === 0 ? (
              <EmptyState icon="🔗" title="No social accounts" description="Link social media accounts to track cross-platform presence." />
            ) : (
              <div className="cd-social-grid">
                {socialAccounts.map(acct => (
                  <Card key={acct.id} variant="outlined" style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <Badge
                        variant="neutral"
                        style={{ background: `${PLATFORM_COLORS[acct.platform] ?? "var(--cc-primary)"}18`, color: PLATFORM_COLORS[acct.platform] ?? "var(--cc-primary)" }}
                      >
                        {acct.platform}
                      </Badge>
                      <button
                        onClick={() => handleRemoveSocial(acct.id)}
                        title="Remove account"
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: 4,
                          color: "var(--cc-text-muted)", borderRadius: 4,
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)", marginBottom: 4 }}>
                      {acct.handle.startsWith("@") ? acct.handle : `@${acct.handle}`}
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 8 }}>
                      <span><Users size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />{formatNumber(acct.followersCount)} followers</span>
                      <span><Eye size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />{formatNumber(acct.avgViews)} avg views</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--cc-text-subtle)" }}>
                      Connected {new Date(acct.createdAt).toLocaleDateString()}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Payouts Tab */}
        {activeTab === "payouts" && (
          creator.payouts.length === 0 ? (
            <EmptyState icon="💸" title="No payouts yet" description="Payment history will appear here." />
          ) : (
            <Card variant="solid" noPadding>
              {/* Desktop header */}
              <div className="cd-payouts-header">
                {["Campaign", "Amount", "Status", "Date"].map(h => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                ))}
              </div>
              <div className="cc-stagger">
                {creator.payouts.map((p, i) => (
                  <div key={p.id}>
                    {/* Desktop row */}
                    <div
                      className="cd-payout-row cc-table-row"
                      style={{ borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
                    >
                      <span style={{ fontSize: 14, color: "var(--cc-text)" }}>{p.campaign?.title ?? "—"}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(Number(p.amount), p.currency)}</span>
                      <Badge variant={STATUS_VARIANT[p.status] ?? "neutral"} dot>{p.status}</Badge>
                      <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{new Date(p.createdAt).toLocaleDateString()}</span>
                    </div>
                    {/* Mobile card */}
                    <div className="cd-payout-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{p.campaign?.title ?? "—"}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(Number(p.amount), p.currency)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Badge variant={STATUS_VARIANT[p.status] ?? "neutral"} dot>{p.status}</Badge>
                        <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{new Date(p.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )
        )}
      </motion.div>

      <EditCreatorModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        creator={creator}
        onSaved={refreshCreator}
      />
    </div>
  );
}
