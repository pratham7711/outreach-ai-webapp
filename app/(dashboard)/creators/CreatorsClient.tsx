"use client";

import { useState } from "react";
import { Plus, LayoutGrid, List as ListIcon } from "lucide-react";
import { Button, Badge, Card, Input, Avatar, EmptyState, Tag } from "@pratham7711/ui";
import { Search } from "lucide-react";
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
    <div className="cc-page-content">
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Creators
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Discover and manage your creator roster
          </p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)}>
          Add Creator
        </Button>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search creators..."
            iconLeft={<Search size={16} />}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: 4 }}>
          <Button variant={view === "grid" ? "primary" : "ghost"} size="sm" onClick={() => setView("grid")} aria-label="Grid view">
            <LayoutGrid size={16} />
          </Button>
          <Button variant={view === "table" ? "primary" : "ghost"} size="sm" onClick={() => setView("table")} aria-label="Table view">
            <ListIcon size={16} />
          </Button>
        </div>
      </div>

      {/* Platform filter tags */}
      <div style={{ marginBottom: 24, display: "flex", gap: 8 }}>
        {PLATFORMS.map((p) => (
          <Tag
            key={p}
            variant={platformFilter === p ? "accent" : "neutral"}
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
            <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
              Add Creator
            </Button>
          }
        />
      ) : view === "grid" ? (
        <div className="cc-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 20 }}>
          {filtered.map((creator) => (
            <Link key={creator.id} href={`/creators/${creator.id}`} style={{ textDecoration: "none" }}>
              <Card variant="solid" clickable style={{ padding: 24 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
                  <Avatar name={creator.name} size="lg" src={creator.avatarUrl ?? undefined} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)", marginBottom: 3 }}>{creator.name}</p>
                    <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>@{creator.handle}</p>
                  </div>
                  <Badge variant={PLATFORM_BADGE_VARIANT[creator.platform] ?? "neutral"}>
                    {creator.platform}
                  </Badge>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 3, fontWeight: 600, letterSpacing: "0.3px", textTransform: "uppercase" }}>Followers</p>
                    <p style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)" }}>{creator.followerCount ? formatNumber(creator.followerCount) : "—"}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 3, fontWeight: 600, letterSpacing: "0.3px", textTransform: "uppercase" }}>Engagement</p>
                    <p style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)" }}>{creator.engagementRate ? `${creator.engagementRate}%` : "—"}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" fullWidth>View Profile</Button>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card variant="solid" noPadding>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--cc-hover-bg)" }}>
                {["Creator", "Platform", "Followers", "Engagement", "Rate", "Campaigns"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)", padding: "12px 24px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="cc-table-row" style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td style={{ padding: "14px 24px" }}>
                    <Link href={`/creators/${c.id}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12 }}>
                      <Avatar name={c.name} size="sm" src={c.avatarUrl ?? undefined} />
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{c.name}</p>
                        <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{c.handle}</p>
                      </div>
                    </Link>
                  </td>
                  <td style={{ padding: "14px 24px" }}>
                    <Badge variant={PLATFORM_BADGE_VARIANT[c.platform] ?? "neutral"}>{c.platform}</Badge>
                  </td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c.followerCount ? formatNumber(c.followerCount) : "—"}</td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c.engagementRate ? `${c.engagementRate}%` : "—"}</td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c.rate ? `$${c.rate}` : "—"}</td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c._count.activations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showModal && <AddCreatorModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
