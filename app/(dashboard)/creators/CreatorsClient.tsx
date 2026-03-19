"use client";

import { useState } from "react";
import { Plus, Search, LayoutGrid, List as ListIcon } from "lucide-react";
import { Button, Badge, EmptyState, Input, Tag } from "@pratham7711/ui";
import AddCreatorModal from "@/components/modals/AddCreatorModal";
import Link from "next/link";

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followerCount: number | null;
  engagementRate: number | null;
  rate: number | null;
  _count: { activations: number };
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PLATFORMS = ["All", "Instagram", "YouTube", "TikTok", "Twitter"];

const PLATFORM_BADGE_VARIANT: Record<string, "accent" | "danger" | "neutral" | "warning" | "success"> = {
  Instagram: "accent",
  YouTube: "danger",
  TikTok: "neutral",
  Twitter: "neutral",
};

export default function CreatorsClient({ creators }: { creators: Creator[] }) {
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("All");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [showModal, setShowModal] = useState(false);

  const filtered = creators.filter((c) => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.handle.toLowerCase().includes(search.toLowerCase());
    const matchPlatform = platformFilter === "All" || c.platform === platformFilter;
    return matchSearch && matchPlatform;
  });

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Creators</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Discover and manage your creator roster</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
          Add Creator
        </Button>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search creators..."
            iconLeft={<Search size={16} />}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: 4 }}>
          <button onClick={() => setView("grid")} style={{ padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer", background: view === "grid" ? "rgba(91,91,214,0.12)" : "transparent", color: view === "grid" ? "var(--cc-primary)" : "var(--cc-text-muted)", display: "flex", alignItems: "center" }}>
            <LayoutGrid size={16} />
          </button>
          <button onClick={() => setView("table")} style={{ padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer", background: view === "table" ? "rgba(91,91,214,0.12)" : "transparent", color: view === "table" ? "var(--cc-primary)" : "var(--cc-text-muted)", display: "flex", alignItems: "center" }}>
            <ListIcon size={16} />
          </button>
        </div>
      </div>

      {/* Platform filter tags */}
      <div style={{ marginBottom: 24, display: "flex", gap: 8 }}>
        {PLATFORMS.map((p) => (
          <Tag
            key={p}
            outlined={platformFilter !== p}
            onClick={() => setPlatformFilter(p)}
            style={{ cursor: "pointer", fontWeight: platformFilter === p ? 600 : 400 }}
          >
            {p}
          </Tag>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No creators yet"
          description="Add creators to your roster to get started."
          action={
            <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowModal(true)}>
              Add Creator
            </Button>
          }
        />
      ) : view === "grid" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {filtered.map((creator) => (
            <Link key={creator.id} href={`/creators/${creator.id}`} style={{ textDecoration: "none" }}>
              <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20, cursor: "pointer", transition: "box-shadow 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(28,32,72,0.08)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                  <div style={{ position: "relative" }}>
                    <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--cc-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 14 }}>
                      {creator.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, color: "var(--cc-text)", marginBottom: 2 }}>{creator.name}</p>
                    <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>@{creator.handle}</p>
                  </div>
                  <Badge variant={PLATFORM_BADGE_VARIANT[creator.platform] ?? "neutral"}>
                    {creator.platform}
                  </Badge>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 2 }}>Followers</p>
                    <p style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{creator.followerCount ? formatNumber(creator.followerCount) : "—"}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 2 }}>Engagement</p>
                    <p style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{creator.engagementRate ? `${creator.engagementRate}%` : "—"}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" fullWidth>View Profile</Button>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                {["Creator", "Platform", "Followers", "Engagement", "Rate", "Campaigns"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-muted)", fontWeight: 600, padding: "10px 20px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--cc-border)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F9FAFB"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <td style={{ padding: "12px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--cc-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c.name}</p>
                        <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{c.handle}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "12px 20px" }}>
                    <Badge variant={PLATFORM_BADGE_VARIANT[c.platform] ?? "neutral"}>{c.platform}</Badge>
                  </td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.followerCount ? formatNumber(c.followerCount) : "—"}</td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.engagementRate ? `${c.engagementRate}%` : "—"}</td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.rate ? `$${c.rate}` : "—"}</td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c._count.activations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <AddCreatorModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
