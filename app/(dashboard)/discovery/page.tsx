"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@pratham7711/ui";

const EmptyState = ({ icon, title, description }: { icon: string; title: string; description?: string }) => (
  <div style={{ textAlign: "center", padding: "64px 24px" }}>
    <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
    <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>{title}</h3>
    {description && <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>{description}</p>}
  </div>
);
const SearchInput = ({ value, onChange, placeholder }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) => (
  <div style={{ position: "relative" }}>
    <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--cc-text-muted)", pointerEvents: "none" }} />
    <input value={value} onChange={onChange} placeholder={placeholder} style={{ width: "100%", padding: "10px 12px 10px 36px", border: "1px solid var(--cc-border)", borderRadius: 8, fontSize: 14, background: "var(--cc-card)", color: "var(--cc-text)", outline: "none" }} />
  </div>
);
const FilterTag = ({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) => (
  <button onClick={onClick} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: active ? 600 : 400, cursor: "pointer", border: `1px solid ${active ? "var(--cc-primary)" : "var(--cc-border)"}`, background: active ? "var(--cc-primary)" : "var(--cc-card)", color: active ? "white" : "var(--cc-text-muted)", transition: "all 0.15s" }}>
    {children}
  </button>
);

const DISCOVER_CREATORS = [
  { name: "Luna Park", handle: "@lunapark", niche: "Beauty", platform: "Instagram", followers: 420000, engagement: 7.2, avatar: "LP" },
  { name: "Dev Singh", handle: "@devsingh", niche: "Tech", platform: "YouTube", followers: 280000, engagement: 5.8, avatar: "DS" },
  { name: "Mia Chen", handle: "@miachen", niche: "Fashion", platform: "TikTok", followers: 1500000, engagement: 13.4, avatar: "MC" },
  { name: "Tyler Ford", handle: "@tylerford", niche: "Fitness", platform: "Instagram", followers: 760000, engagement: 9.1, avatar: "TF" },
  { name: "Zara Blake", handle: "@zarablake", niche: "Food", platform: "TikTok", followers: 930000, engagement: 11.2, avatar: "ZB" },
  { name: "Noah Kim", handle: "@noahkim", niche: "Travel", platform: "YouTube", followers: 2100000, engagement: 6.7, avatar: "NK" },
];

const NICHES = ["All", "Beauty", "Fitness", "Tech", "Fashion", "Food", "Travel", "Gaming"];
const PLATFORMS = ["All", "Instagram", "YouTube", "TikTok", "Twitter"];

const AVATAR_COLORS = ["#5B5BD6", "#7C3AED", "#DB2777", "#EA580C", "#059669", "#0284C7"];

function formatFollowers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000).toFixed(0)}K`;
}

export default function DiscoveryPage() {
  const [niche, setNiche] = useState("All");
  const [platform, setPlatform] = useState("All");
  const [search, setSearch] = useState("");

  const filtered = DISCOVER_CREATORS.filter((c) =>
    (niche === "All" || c.niche === niche) &&
    (platform === "All" || c.platform === platform) &&
    (c.name.toLowerCase().includes(search.toLowerCase()) || c.handle.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Discovery</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Find and connect with creators</p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, niche, or platform..." />
      </div>

      {/* Platform filter */}
      <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PLATFORMS.map((p) => (
          <FilterTag key={p} active={platform === p} onClick={() => setPlatform(p)}>{p}</FilterTag>
        ))}
      </div>

      {/* Niche filter */}
      <div style={{ marginBottom: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {NICHES.map((n) => (
          <FilterTag key={n} active={niche === n} onClick={() => setNiche(n)}>{n}</FilterTag>
        ))}
      </div>

      {/* Creator grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No creators found"
          description="Try adjusting your search or filters"
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {filtered.map((c, i) => (
            <div key={c.handle} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: AVATAR_COLORS[i % AVATAR_COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                  {c.avatar}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{c.name}</div>
                  <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{c.handle} · {c.platform}</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>{formatFollowers(c.followers)}</div>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Followers</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#16a34a" }}>{c.engagement}%</div>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Engagement</div>
                </div>
                <div style={{ padding: "4px 10px", borderRadius: 6, background: "#F3F4F8", fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)" }}>
                  {c.niche}
                </div>
              </div>
              <Button variant="primary" fullWidth iconLeft={<Plus size={14} />}>Invite</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
