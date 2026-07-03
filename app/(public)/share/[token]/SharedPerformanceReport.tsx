"use client";
import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import type { CampaignPerformance } from "@/lib/reports/campaignPerformance";

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: "#000000",
  INSTAGRAM: "#E4405F",
  YOUTUBE: "#FF0000",
  TWITTER: "#1DA1F2",
};

const SERIES = [
  { key: "TIKTOK", color: PLATFORM_COLORS.TIKTOK },
  { key: "INSTAGRAM", color: PLATFORM_COLORS.INSTAGRAM },
  { key: "YOUTUBE", color: PLATFORM_COLORS.YOUTUBE },
] as const;

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return String(num);
}

function formatCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 12,
        padding: "16px 20px",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)", fontWeight: 500 }}>{label}</div>
    </div>
  );
}

export default function SharedPerformanceReport({
  token,
  campaignTitle,
  data,
}: {
  token: string;
  campaignTitle: string;
  data: CampaignPerformance;
}) {
  const isMobile = useIsMobile();
  const { kpis, timeSeries, platformSplit, leaderboard, currency, spendSource } = data;
  const engRateDisplay = kpis.engagementRate !== null ? (kpis.engagementRate * 100).toFixed(2) + "%" : "—";

  const isEmpty = kpis.views === 0 && leaderboard.length === 0 && timeSeries.length === 0;

  const kpiColumns = isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)";
  const lowerColumns = isMobile ? "1fr" : "1fr 1.4fr";

  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: isMobile ? "24px 16px 64px" : "40px 24px 80px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 32,
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cc-text-muted)", marginBottom: 6 }}>
              Campaign Performance Report
            </div>
            <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
              {campaignTitle}
            </h1>
          </div>
          {!isEmpty && (
            <a
              href={`/api/share/${token}/pdf`}
              style={{
                background: "var(--cc-primary)",
                color: "var(--cc-card)",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              Download PDF
            </a>
          )}
        </div>

        {isEmpty ? (
          <div
            style={{
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              borderRadius: 12,
              padding: 48,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 6px" }}>
              No performance data yet
            </h2>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
              Metrics will appear here once content goes live for this campaign.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: kpiColumns, gap: 16 }}>
              <StatTile value={formatNumber(kpis.views)} label="Views" />
              <StatTile value={formatNumber(kpis.engagements)} label="Engagements" />
              <StatTile value={engRateDisplay} label="Eng. Rate" />
              <StatTile
                value={formatCurrency(kpis.spend, currency)}
                label={spendSource === "PAID_PAYOUTS" ? "Spend (paid)" : "Spend (budget)"}
              />
              <StatTile
                value={`${kpis.cpm !== null ? formatCurrency(kpis.cpm, currency) : "—"} / ${kpis.cpe !== null ? formatCurrency(kpis.cpe, currency) : "—"}`}
                label="CPM / CPE"
              />
              <StatTile value={formatCurrency(kpis.emv, currency)} label="EMV" />
            </div>

            <div
              style={{
                background: "var(--cc-card)",
                border: "1px solid var(--cc-border)",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
                Views Over Time by Platform
              </span>
              {timeSeries.length > 0 ? (
                <div style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <defs>
                        {SERIES.map((s) => (
                          <linearGradient key={s.key} id={`shareGrad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
                      <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                      <YAxis tickFormatter={(v) => formatNumber(Number(v))} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                      <Tooltip
                        labelFormatter={(l) => formatDate(String(l))}
                        formatter={(v: unknown) => formatNumber(Number(v ?? 0))}
                        contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {SERIES.map((s) => (
                        <Area
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          stackId="views"
                          stroke={s.color}
                          fill={`url(#shareGrad-${s.key})`}
                          strokeWidth={2}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
                  Views over time will appear as posts accumulate metrics.
                </p>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: lowerColumns, gap: 24 }}>
              <div
                style={{
                  background: "var(--cc-card)",
                  border: "1px solid var(--cc-border)",
                  borderRadius: 12,
                  padding: 24,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
                  Platform Split
                </span>
                {platformSplit.length > 0 ? (
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={platformSplit}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          dataKey="views"
                          nameKey="platform"
                          paddingAngle={2}
                          label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                        >
                          {platformSplit.map((entry) => (
                            <Cell key={entry.platform} fill={PLATFORM_COLORS[entry.platform] ?? "var(--cc-primary)"} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: unknown, _n: unknown, item: { payload?: { posts?: number; platform?: string } }) => [
                            `${formatNumber(Number(v ?? 0))} views · ${item?.payload?.posts ?? 0} posts`,
                            item?.payload?.platform ?? "",
                          ]}
                          contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>No platform data.</p>
                )}
              </div>

              <div
                style={{
                  background: "var(--cc-card)",
                  border: "1px solid var(--cc-border)",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Top Creators</span>
                </div>
                {leaderboard.length > 0 ? (
                  <div style={{ overflowX: "auto" }}>
                    <div style={{ minWidth: isMobile ? 420 : "auto" }}>
                      <div style={{
                        display: "grid", gridTemplateColumns: "1fr 70px 90px 80px 90px",
                        gap: 12, padding: "10px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
                      }}>
                        {["Creator", "Posts", "Views", "Eng.", "EMV"].map((h) => (
                          <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                        ))}
                      </div>
                      {leaderboard.map((row, i) => (
                        <div
                          key={row.creatorId}
                          style={{
                            display: "grid", gridTemplateColumns: "1fr 70px 90px 80px 90px", gap: 12,
                            padding: "12px 24px", alignItems: "center",
                            borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <div
                              style={{
                                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                                background: "var(--cc-primary)", color: "white", overflow: "hidden",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 700,
                              }}
                            >
                              {row.avatarUrl ? (
                                <img src={row.avatarUrl} alt={row.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                row.name.charAt(0).toUpperCase()
                              )}
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                          </div>
                          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{row.posts}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(row.views)}</span>
                          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{row.engagementRate !== null ? (row.engagementRate * 100).toFixed(1) + "%" : "—"}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-primary)" }}>{formatCurrency(row.emv, currency)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: 24, fontSize: 14, color: "var(--cc-text-muted)" }}>No creators yet.</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", padding: "32px 0 0" }}>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>Powered by Outreach AI</p>
        </div>
      </div>
    </div>
  );
}
