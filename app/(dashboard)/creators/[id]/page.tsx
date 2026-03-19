"use client";
import { useState, useEffect, use } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Eye, Heart, Play, ChevronRight,
} from "lucide-react";
import Link from "next/link";

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

const DUMMY_POSTS = [
  { id: 1, title: "Summer Vibes Reel", views: 450000, likes: 32000, gradient: "from-blue-600 to-cyan-500" },
  { id: 2, title: "Behind the Scenes", views: 120000, likes: 8900, gradient: "from-pink-600 to-purple-500" },
  { id: 3, title: "Product Unboxing", views: 890000, likes: 67000, gradient: "from-orange-500 to-red-500" },
  { id: 4, title: "Dance Challenge", views: 2100000, likes: 180000, gradient: "from-green-500 to-teal-500" },
  { id: 5, title: "Day in My Life", views: 340000, likes: 21000, gradient: "from-purple-600 to-blue-500" },
  { id: 6, title: "Tutorial Series", views: 78000, likes: 5400, gradient: "from-red-500 to-orange-500" },
];

type Tab = "profile" | "posts" | "campaigns";

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  bio: string | null;
  contactEmail: string | null;
  followersCount: number;
  averageViews: number;
  rate: string | null;
  activations: {
    id: string;
    status: string;
    campaign: { id: string; title: string; status: string; budget: string | null; currency: string };
  }[];
  payouts: { id: string; amount: string; status: string; currency: string }[];
  _count: { activations: number; posts: number };
};

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

  const tabsList: { label: string; value: Tab }[] = [
    { label: "Profile", value: "profile" },
    { label: "Posts", value: "posts" },
    { label: "Campaigns", value: "campaigns" },
  ];

  if (loading) return <div style={{ padding: 32, color: "var(--cc-text-muted)" }}>Loading...</div>;
  if (!creator) return <div style={{ padding: 32, color: "var(--cc-text-muted)" }}>Creator not found</div>;

  const initials = creator.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  const totalPaid = creator.payouts
    .filter(p => p.status === "SUCCESS")
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  return (
    <div style={{ padding: 32 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 24, color: "var(--cc-text-muted)" }}>
        <Link href="/creators" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--cc-text-muted)", textDecoration: "none" }}>
          <ArrowLeft size={16} /> Creators
        </Link>
        <ChevronRight size={12} />
        <span style={{ color: "var(--cc-text)" }}>{creator.name}</span>
      </div>

      {/* Banner + Profile */}
      <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16, overflow: "hidden", marginBottom: 32 }}>
        <div style={{ height: 96, background: "linear-gradient(to right, rgba(91,91,214,0.15), rgba(168,85,247,0.15))" }} />
        <div style={{ padding: "0 24px 24px", marginTop: -40 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
            <div style={{ height: 80, width: 80, borderRadius: 16, background: "var(--cc-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, color: "white", border: "4px solid var(--cc-card)", flexShrink: 0 }}>
              {initials}
            </div>
            <div style={{ flex: 1, paddingBottom: 4 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 2 }}>{creator.name}</h1>
              <div style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>{creator.handle} · {creator.platform}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 24 }}>
            {[
              { label: "Followers", value: formatNumber(creator.followersCount) },
              { label: "Avg Views", value: formatNumber(creator.averageViews) },
              { label: "Campaigns", value: String(creator._count.activations) },
              { label: "Total Paid", value: totalPaid > 0 ? "$" + totalPaid.toLocaleString() : "—" },
            ].map(s => (
              <div key={s.label} style={{ borderRadius: 10, padding: 16, background: "#F3F4F8" }}>
                <div style={{ fontSize: 10, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--cc-border)" }}>
        {tabsList.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 500,
              background: "none",
              border: "none",
              cursor: "pointer",
              borderBottom: activeTab === tab.value ? "2px solid var(--cc-primary)" : "2px solid transparent",
              color: activeTab === tab.value ? "var(--cc-primary)" : "var(--cc-text-muted)",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {activeTab === "profile" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16, padding: 24 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>About</span>
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", lineHeight: 1.6 }}>
                {creator.bio ?? `${creator.platform} content creator. Open to brand partnerships and collaborations.`}
              </p>
              {creator.contactEmail && (
                <div style={{ marginTop: 16, fontSize: 13, color: "var(--cc-text-muted)" }}>{creator.contactEmail}</div>
              )}
            </div>
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16, padding: 24 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Rates</span>
              {creator.rate ? (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--cc-border)" }}>
                  <span style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Rate</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>${parseFloat(creator.rate).toLocaleString()}</span>
                </div>
              ) : (
                <div style={{ padding: "16px 0", textAlign: "center", fontSize: 13, color: "var(--cc-text-muted)" }}>No rate set</div>
              )}
            </div>
          </div>
        )}

        {activeTab === "posts" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {DUMMY_POSTS.map(post => (
              <div key={post.id} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16, overflow: "hidden" }}>
                <div className={`h-48 bg-gradient-to-br ${post.gradient}`} style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(0,0,0,0.3)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0 }}>
                    <Play size={20} color="white" style={{ marginLeft: 2 }} />
                  </div>
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>{post.title}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--cc-text-muted)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Eye size={12} />{formatNumber(post.views)}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Heart size={12} />{formatNumber(post.likes)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "campaigns" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {creator.activations.length === 0 ? (
              <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "var(--cc-text-muted)" }}>No campaigns yet</div>
            ) : creator.activations.map(act => (
              <Link key={act.id} href={`/campaigns/${act.campaign.id}`} style={{ textDecoration: "none" }}>
                <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 16, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--cc-primary)", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{act.campaign.title}</div>
                      <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{act.campaign.status}</div>
                    </div>
                    {act.campaign.budget && (
                      <span style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>
                        {act.campaign.currency} {formatNumber(parseFloat(act.campaign.budget))}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
