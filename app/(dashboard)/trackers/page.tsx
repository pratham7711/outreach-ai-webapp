"use client";
import { Badge, Card, StatCard } from "@pratham7711/ui";
import { Music } from "lucide-react";

const TRACKERS = [
  { id: "t1", sound: "Original Sound — Summer Vibes", platform: "TikTok", uses: 45200, growth: "+12%", status: "trending" },
  { id: "t2", sound: "Beat Drop Remix", platform: "TikTok", uses: 128000, growth: "+34%", status: "viral" },
  { id: "t3", sound: "Chill Lofi Mix", platform: "Instagram", uses: 8900, growth: "+5%", status: "stable" },
  { id: "t4", sound: "Dance Challenge Audio", platform: "TikTok", uses: 67000, growth: "-2%", status: "declining" },
];

const STATUS_BADGE: Record<string, "success"|"accent"|"neutral"|"danger"> = {
  trending: "accent",
  viral: "success",
  stable: "neutral",
  declining: "danger",
};

export default function TrackersPage() {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Trackers</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Track TikTok sounds and trends</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard value="4" label="Active Trackers" />
        <StatCard value="249K" label="Total Uses" trend={18} />
        <StatCard value="1" label="Viral Sounds" />
        <StatCard value="+12%" label="Avg. Growth" />
      </div>

      <Card variant="glass" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>Sound Trackers</span>
        </div>
        {TRACKERS.map((t, i) => (
          <div key={t.id} className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: i < TRACKERS.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(37,99,235,0.1)" }}>
              <Music size={18} style={{ color: "#3b82f6" }} />
            </div>
            <div className="flex-1">
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{t.sound}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{t.platform}</div>
            </div>
            <Badge variant={STATUS_BADGE[t.status]} size="sm">{t.status}</Badge>
            <div className="text-right">
              <div style={{ fontWeight: 800, fontSize: 14, color: "var(--cc-text)" }}>{t.uses.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: t.growth.startsWith("+") ? "#22c55e" : "#ef4444" }}>{t.growth}</div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
