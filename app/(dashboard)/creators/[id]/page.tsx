"use client";
import { useState, useEffect, use } from "react";
import { motion } from "framer-motion";
import { Card, Badge } from "@pratham7711/ui";
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

  if (loading) return <div className="p-8" style={{ color: "var(--cc-text-muted)" }}>Loading...</div>;
  if (!creator) return <div className="p-8" style={{ color: "var(--cc-text-muted)" }}>Creator not found</div>;

  const initials = creator.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  const totalPaid = creator.payouts
    .filter(p => p.status === "SUCCESS")
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-6" style={{ color: "var(--cc-text-muted)" }}>
        <Link href="/creators" className="flex items-center gap-1" style={{ color: "var(--cc-text-muted)" }}>
          <ArrowLeft className="h-4 w-4" /> Creators
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span style={{ color: "var(--cc-text)" }}>{creator.name}</span>
      </div>

      {/* Banner + Profile */}
      <Card variant="glass" className="overflow-hidden mb-8" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
        <div className="h-32 bg-gradient-to-r from-blue-600/20 to-purple-600/20" />
        <div className="px-6 pb-6 -mt-10">
          <div className="flex items-end gap-4">
            <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-2xl font-black text-white" style={{ border: "4px solid var(--cc-surface)" }}>
              {initials}
            </div>
            <div className="flex-1 pb-1">
              <div className="flex items-center gap-3">
                <h1 style={{ fontSize: 24, fontWeight: 900, color: "var(--cc-text)" }}>{creator.name}</h1>
              </div>
              <div style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 2 }}>{creator.handle} · {creator.platform}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
            {[
              { label: "Followers", value: formatNumber(creator.followersCount) },
              { label: "Avg Views", value: formatNumber(creator.averageViews) },
              { label: "Campaigns", value: String(creator._count.activations) },
              { label: "Total Paid", value: totalPaid > 0 ? "$" + totalPaid.toLocaleString() : "—" },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-4" style={{ background: "var(--cc-surface-2)" }}>
                <div style={{ fontSize: 10, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "var(--cc-text)" }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: "1px solid var(--cc-border)" }}>
        {tabsList.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className="px-5 py-3 text-sm font-medium transition-all"
            style={{
              borderBottom: activeTab === tab.value ? "2px solid #2563EB" : "2px solid transparent",
              color: activeTab === tab.value ? "#3b82f6" : "var(--cc-text-muted)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {activeTab === "profile" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card variant="glass" className="p-6" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>About</span>
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", lineHeight: 1.6 }}>
                {creator.bio ?? `${creator.platform} content creator. Open to brand partnerships and collaborations.`}
              </p>
              {creator.contactEmail && (
                <div className="mt-4" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{creator.contactEmail}</div>
              )}
            </Card>
            <Card variant="glass" className="p-6" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 12 }}>Rates</span>
              {creator.rate ? (
                <div className="flex justify-between py-2" style={{ borderBottom: "1px solid var(--cc-border)" }}>
                  <span style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Rate</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>${parseFloat(creator.rate).toLocaleString()}</span>
                </div>
              ) : (
                <div className="py-4 text-center" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No rate set</div>
              )}
            </Card>
          </div>
        )}

        {activeTab === "posts" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {DUMMY_POSTS.map(post => (
              <Card key={post.id} variant="glass" className="overflow-hidden" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
                <div className={`h-48 bg-gradient-to-br ${post.gradient} flex items-center justify-center`}>
                  <div className="h-12 w-12 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <Play className="h-5 w-5 text-white ml-0.5" />
                  </div>
                </div>
                <div className="p-4">
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

        {activeTab === "campaigns" && (
          <div className="flex flex-col gap-3">
            {creator.activations.length === 0 ? (
              <div className="py-8 text-center" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No campaigns yet</div>
            ) : creator.activations.map(act => (
              <Link key={act.id} href={`/campaigns/${act.campaign.id}`}>
                <Card variant="glass" className="p-5" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
                  <div className="flex items-center gap-4">
                    <div className="w-2 h-2 rounded-full" style={{ background: "#3b82f6" }} />
                    <div className="flex-1">
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{act.campaign.title}</div>
                      <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{act.campaign.status}</div>
                    </div>
                    {act.campaign.budget && (
                      <span style={{ fontWeight: 800, fontSize: 14, color: "var(--cc-text)" }}>
                        {act.campaign.currency} {formatNumber(parseFloat(act.campaign.budget))}
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
