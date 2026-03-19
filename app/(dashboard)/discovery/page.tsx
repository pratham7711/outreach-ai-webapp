"use client";
import { useState } from "react";
import { Search, SlidersHorizontal, Plus } from "lucide-react";

const DISCOVER_CREATORS = [
  { name: "Luna Park", handle: "@lunapark", niche: "Beauty", platform: "Instagram", followers: 420000, engagement: 7.2, avatar: "LP" },
  { name: "Dev Singh", handle: "@devsingh", niche: "Tech", platform: "YouTube", followers: 280000, engagement: 5.8, avatar: "DS" },
  { name: "Mia Chen", handle: "@miachen", niche: "Fashion", platform: "TikTok", followers: 1500000, engagement: 13.4, avatar: "MC" },
  { name: "Tyler Ford", handle: "@tylerford", niche: "Fitness", platform: "Instagram", followers: 760000, engagement: 9.1, avatar: "TF" },
  { name: "Zara Blake", handle: "@zarablake", niche: "Food", platform: "TikTok", followers: 930000, engagement: 11.2, avatar: "ZB" },
  { name: "Noah Kim", handle: "@noahkim", niche: "Travel", platform: "YouTube", followers: 2100000, engagement: 6.7, avatar: "NK" },
];

const NICHES = ["All", "Beauty", "Fitness", "Tech", "Fashion", "Food", "Travel", "Gaming"];

const AVATAR_COLORS = ["#5B5BD6", "#7C3AED", "#DB2777", "#EA580C", "#059669", "#0284C7"];

export default function DiscoveryPage() {
  const [niche, setNiche] = useState("All");
  const [search, setSearch] = useState("");
  const filtered = DISCOVER_CREATORS.filter((c) =>
    (niche === "All" || c.niche === niche) &&
    (c.name.toLowerCase().includes(search.toLowerCase()) || c.handle.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Discovery</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Find and add new creators to your campaigns</p>
        </div>
      </div>

      {/* Search + Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, background: "var(--cc-card)", border: "1px solid var(--cc-border)" }}>
          <Search size={16} style={{ color: "var(--cc-text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, niche, handle..."
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 14, color: "var(--cc-text)" }}
          />
        </div>
        <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 12, background: "var(--cc-card)", border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text-muted)", cursor: "pointer", fontWeight: 500 }}>
          <SlidersHorizontal size={15} /> Filters
        </button>
      </div>

      {/* Niche pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {NICHES.map((n) => (
          <button
            key={n}
            onClick={() => setNiche(n)}
            style={{
              padding: "6px 16px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: niche === n ? "var(--cc-primary)" : "var(--cc-card)",
              color: niche === n ? "white" : "var(--cc-text-muted)",
              border: `1px solid ${niche === n ? "var(--cc-primary)" : "var(--cc-border)"}`,
              transition: "all 0.15s",
            }}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Creator grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {filtered.map((c, i) => (
          <div key={c.handle} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: AVATAR_COLORS[i % AVATAR_COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{c.avatar}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{c.name}</div>
                <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{c.handle} · {c.platform}</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>
                  {c.followers >= 1000000 ? `${(c.followers / 1000000).toFixed(1)}M` : `${(c.followers / 1000).toFixed(0)}K`}
                </div>
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
            <button style={{ width: "100%", padding: "9px 0", borderRadius: 8, background: "var(--cc-primary)", color: "white", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Plus size={14} /> Invite
            </button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: "48px 0", textAlign: "center", fontSize: 14, color: "var(--cc-text-muted)" }}>
          No creators match your search.
        </div>
      )}
    </div>
  );
}
