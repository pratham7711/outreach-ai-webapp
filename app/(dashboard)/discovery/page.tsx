"use client";
import { useState } from "react";
import { Button, Badge, Card } from "@pratham7711/ui";
import { Search, SlidersHorizontal } from "lucide-react";

const DISCOVER_CREATORS = [
  { name: "Luna Park", handle: "@lunapark", niche: "Beauty", platform: "Instagram", followers: 420000, engagement: 7.2, avatar: "LP" },
  { name: "Dev Singh", handle: "@devsingh", niche: "Tech", platform: "YouTube", followers: 280000, engagement: 5.8, avatar: "DS" },
  { name: "Mia Chen", handle: "@miachen", niche: "Fashion", platform: "TikTok", followers: 1500000, engagement: 13.4, avatar: "MC" },
  { name: "Tyler Ford", handle: "@tylerford", niche: "Fitness", platform: "Instagram", followers: 760000, engagement: 9.1, avatar: "TF" },
  { name: "Zara Blake", handle: "@zarablake", niche: "Food", platform: "TikTok", followers: 930000, engagement: 11.2, avatar: "ZB" },
  { name: "Noah Kim", handle: "@noahkim", niche: "Travel", platform: "YouTube", followers: 2100000, engagement: 6.7, avatar: "NK" },
];

const NICHES = ["All", "Beauty", "Fitness", "Tech", "Fashion", "Food", "Travel", "Gaming"];

export default function DiscoveryPage() {
  const [niche, setNiche] = useState("All");
  const [search, setSearch] = useState("");
  const filtered = DISCOVER_CREATORS.filter((c) =>
    (niche === "All" || c.niche === niche) &&
    (c.name.toLowerCase().includes(search.toLowerCase()) || c.handle.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Discovery</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Find and add new creators to your campaigns</p>
      </div>

      {/* Search */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)" }}>
          <Search size={16} style={{ color: "var(--cc-text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, niche, handle..." style={{ background: "none", border: "none", outline: "none", color: "var(--cc-text)", fontSize: 14, flex: 1 }} />
        </div>
        <Button variant="ghost" iconLeft={<SlidersHorizontal size={15} />}>Filters</Button>
      </div>

      {/* Niche pills */}
      <div className="flex gap-2 flex-wrap mb-6">
        {NICHES.map((n) => (
          <button
            key={n}
            onClick={() => setNiche(n)}
            className="px-4 py-1.5 rounded-full text-sm transition-all"
            style={{
              background: niche === n ? "#2563EB" : "var(--cc-surface)",
              color: niche === n ? "white" : "var(--cc-text-muted)",
              border: `1px solid ${niche === n ? "#2563EB" : "var(--cc-border)"}`,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Creator grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c) => (
          <Card key={c.handle} variant="glass" className="p-5" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 flex items-center justify-center text-white font-bold text-sm">{c.avatar}</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "var(--cc-text)" }}>{c.name}</div>
                <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{c.handle} · {c.platform}</div>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "var(--cc-text)" }}>
                  {c.followers >= 1000000 ? `${(c.followers/1000000).toFixed(1)}M` : `${(c.followers/1000).toFixed(0)}K`}
                </div>
                <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Followers</div>
              </div>
              <div className="text-center">
                <div style={{ fontWeight: 800, fontSize: 14, color: "#22c55e" }}>{c.engagement}%</div>
                <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Engagement</div>
              </div>
              <Badge variant="neutral" size="sm">{c.niche}</Badge>
            </div>
            <Button variant="primary" size="sm" fullWidth className="mt-4">+ Invite</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
