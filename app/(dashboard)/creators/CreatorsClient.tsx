"use client";

import { useState } from "react";
import { Plus, LayoutGrid, List as ListIcon, Users } from "lucide-react";
import { Button, Badge, Card, Input, Avatar, EmptyState } from "@pratham7711/ui";
import { StatusTabs } from "@/components/ds";
import { Search } from "lucide-react";
import AddCreatorModal from "@/components/modals/AddCreatorModal";
import Link from "next/link";
import { formatCompact, stripAt, platformLabel } from "@/lib/format";

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followerCount: number | null;
  avgViews: number | null;
  rate: number | null;
  _count: { activations: number };
};

function formatNumber(n: number): string {
  return formatCompact(n);
}

const PLATFORM_TABS = [
  { key: "All", label: "All" },
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "YOUTUBE", label: "YouTube" },
  { key: "TIKTOK", label: "TikTok" },
  { key: "TWITTER", label: "Twitter" },
];

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
    const matchPlatform = platformFilter === "All" || c.platform.toUpperCase() === platformFilter;
    return matchSearch && matchPlatform;
  });

  return (
    <div className="rsp-page">
      {/* Header */}
      <div className="rsp-header">
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
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
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

      <StatusTabs
        ariaLabel="Filter creators by platform"
        style={{ marginBottom: 24 }}
        tabs={PLATFORM_TABS.map((t) => ({
          ...t,
          count: t.key === "All" ? creators.length : creators.filter((c) => c.platform.toUpperCase() === t.key).length,
        }))}
        active={platformFilter}
        onChange={setPlatformFilter}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users size={32} color="var(--cc-text-subtle)" />}
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
              <Card variant="solid" className="ui-card-clickable" style={{ padding: 24 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
                  <Avatar name={creator.name} size="lg" src={creator.avatarUrl ?? undefined} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)", marginBottom: 3 }}>{creator.name}</p>
                    <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>@{stripAt(creator.handle)}</p>
                  </div>
                  <Badge variant={PLATFORM_BADGE_VARIANT[creator.platform] ?? "neutral"}>
                    {platformLabel(creator.platform)}
                  </Badge>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 3, fontWeight: 600, letterSpacing: "0.3px", textTransform: "uppercase" }}>Followers</p>
                    <p style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)" }}>{creator.followerCount ? formatNumber(creator.followerCount) : "—"}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 3, fontWeight: 600, letterSpacing: "0.3px", textTransform: "uppercase" }}>Avg. Views</p>
                    <p style={{ fontWeight: 700, fontSize: 16, color: "var(--cc-text)" }}>{creator.avgViews ? formatNumber(creator.avgViews) : "—"}</p>
                  </div>
                </div>
                <div className="ui-btn ui-btn-ghost ui-btn-sm" style={{ width: "100%", justifyContent: "center", pointerEvents: "none" }} aria-hidden="true">View Profile</div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card variant="solid" noPadding>
          <div className="rsp-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--cc-hover-bg)" }}>
                {["Creator", "Platform", "Followers", "Avg. Views", "Rate", "Campaigns"].map((h) => (
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
                        <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{stripAt(c.handle)}</p>
                      </div>
                    </Link>
                  </td>
                  <td style={{ padding: "14px 24px" }}>
                    <Badge variant={PLATFORM_BADGE_VARIANT[c.platform] ?? "neutral"}>{platformLabel(c.platform)}</Badge>
                  </td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c.followerCount ? formatNumber(c.followerCount) : "—"}</td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c.avgViews ? formatNumber(c.avgViews) : "—"}</td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c.rate ? `$${c.rate}` : "—"}</td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c._count.activations}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {showModal && <AddCreatorModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
