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
    <div className="cc-page-content">
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Trackers</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Track TikTok sounds and trends</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard value="4" label="Active Trackers" />
        <StatCard value="249K" label="Total Uses" />
        <StatCard value="1" label="Viral Sounds" />
        <StatCard value="+12%" label="Avg. Growth" />
      </div>

      <Card variant="outlined" noPadding>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Sound Trackers</span>
        </div>
        {TRACKERS.map((t, i) => (
          <div
            key={t.id}
            className="cc-table-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "14px 20px",
              borderBottom: i < TRACKERS.length - 1 ? "1px solid var(--cc-border)" : "none",
            }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cc-primary-light)" }}>
              <Music size={18} style={{ color: "var(--cc-primary)" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{t.sound}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{t.platform}</div>
            </div>
            <Badge variant={STATUS_BADGE[t.status]} size="sm">{t.status}</Badge>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{t.uses.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: t.growth.startsWith("+") ? "#22c55e" : "#ef4444" }}>{t.growth}</div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
