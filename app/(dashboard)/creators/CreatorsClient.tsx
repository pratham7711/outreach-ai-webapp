"use client";
import { useState } from "react";
import { Button, Badge, Card } from "@pratham7711/ui";
import { Plus, Search } from "lucide-react";

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

const PLATFORM_COLOR: Record<string, string> = {
  INSTAGRAM: "#e1306c",
  TIKTOK: "#010101",
  YOUTUBE: "#ff0000",
  TWITTER: "#1da1f2",
};

export default function CreatorsClient({ creators }: { creators: Creator[] }) {
  const [search, setSearch] = useState("");
  const filtered = creators.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.handle.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Creators</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>All creators in your roster</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={16} />}>Add Creator</Button>
      </div>

      <div className="flex gap-3 mb-6">
        <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)" }}>
          <Search size={16} style={{ color: "var(--cc-text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search creators..." style={{ background: "none", border: "none", outline: "none", color: "var(--cc-text)", fontSize: 14, flex: 1 }} />
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((creator) => (
          <Card key={creator.id} variant="glass" className="p-5" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {creator.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>{creator.name}</div>
                <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>@{creator.handle}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "var(--cc-text)" }}>
                  {creator.followerCount ? (creator.followerCount >= 1000000 ? `${(creator.followerCount / 1000000).toFixed(1)}M` : `${(creator.followerCount / 1000).toFixed(0)}K`) : "—"}
                </div>
                <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Followers</div>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#22c55e" }}>{creator.engagementRate ? `${Number(creator.engagementRate).toFixed(1)}%` : "—"}</div>
                <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Eng. Rate</div>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "var(--cc-text)" }}>{creator._count.activations}</div>
                <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Activations</div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: "1px solid var(--cc-border)" }}>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                <span style={{ color: PLATFORM_COLOR[creator.platform] || "var(--cc-blue)" }}>●</span>
                &nbsp;{creator.platform}
              </div>
              {creator.rate && (
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-blue)" }}>
                  ${Number(creator.rate).toLocaleString()} rate
                </span>
              )}
            </div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: 40, gridColumn: "1 / -1" }}>No creators found</p>
        )}
      </div>
    </div>
  );
}
