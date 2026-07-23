"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Card, StatCard, Badge, EmptyState, Skeleton, Avatar, Modal } from "@pratham7711/ui";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Eye, Heart, Percent, DollarSign, Target, TrendingUp, Share2, AlertTriangle, BarChart3, PieChart as PieChartIcon, Trophy } from "lucide-react";
import { formatCompact } from "@/lib/format";
import { platformColor } from "@/app/(dashboard)/analytics/shared";

type Kpis = {
  views: number;
  engagements: number;
  engagementRate: number | null;
  spend: number;
  cpm: number | null;
  cpe: number | null;
  emv: number;
};

type TimeSeriesPoint = { date: string; TIKTOK: number; INSTAGRAM: number; YOUTUBE: number };
type PlatformSplit = { platform: string; views: number; posts: number };
type LeaderboardRow = {
  creatorId: string;
  name: string;
  avatarUrl: string | null;
  posts: number;
  views: number;
  engagements: number;
  engagementRate: number | null;
  emv: number;
};

type PerformanceData = {
  currency: string;
  spendSource: "PAID_PAYOUTS" | "BUDGET";
  kpis: Kpis;
  timeSeries: TimeSeriesPoint[];
  platformSplit: PlatformSplit[];
  leaderboard: LeaderboardRow[];
};

const SERIES = [
  { key: "TIKTOK", color: platformColor("TIKTOK") },
  { key: "INSTAGRAM", color: platformColor("INSTAGRAM") },
  { key: "YOUTUBE", color: platformColor("YOUTUBE") },
] as const;

function formatNumber(num: number): string {
  return formatCompact(num);
}

function formatCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

function formatCurrencyCompact(n: number, currency = "USD"): string {
  if (Math.abs(n) < 10000) return formatCurrency(n, currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function formatCostMetric(n: number | null, currency = "USD"): string {
  if (n === null || n <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 0.01 ? 4 : 2,
  }).format(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function LoadingState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <style>{`
        .perf-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
        @media (min-width: 1024px) { .perf-split { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); } }
      `}</style>
      <div className="rsp-grid-tiles">
        {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height="88px" borderRadius="12px" />)}
      </div>
      <Skeleton width="100%" height="320px" borderRadius="12px" />
      <div className="perf-split">
        <Skeleton width="100%" height="300px" borderRadius="12px" />
        <Skeleton width="100%" height="300px" borderRadius="12px" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card variant="outlined" style={{ padding: 32 }}>
      <EmptyState
        icon={<AlertTriangle size={32} color="var(--cc-text-subtle)" />}
        title="Couldn't load performance"
        description="Something went wrong while fetching campaign performance."
        action={
          <button
            onClick={onRetry}
            style={{
              background: "var(--cc-primary)", color: "var(--cc-card)", border: "none",
              borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            Retry
          </button>
        }
      />
    </Card>
  );
}

type ShareLink = { token: string; isPublic: boolean; createdAt: string; path: string };

function ShareModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`);
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      setLink(json.link ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  const shareUrl = link ? `${typeof window !== "undefined" ? window.location.origin : ""}${link.path}` : "";

  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      setLink(json.link ?? null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      setLink(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(true);
    }
  };

  return (
    <Modal open onClose={onClose} title="Share report" size="sm">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.6 }}>
          Generate a read-only link to this campaign&apos;s performance report. Anyone with the link
          can view it — no login required. Revoke it anytime.
        </p>

        {loading ? (
          <Skeleton width="100%" height="44px" borderRadius="8px" />
        ) : link ? (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  flex: 1, minWidth: 0, fontSize: 13, color: "var(--cc-text)",
                  background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                  borderRadius: 8, padding: "8px 12px",
                }}
              />
              <button
                onClick={copy}
                style={{
                  background: "var(--cc-primary)", color: "var(--cc-card)", border: "none",
                  borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              onClick={revoke}
              disabled={busy}
              style={{
                background: "var(--cc-card)", color: "#DC2626", border: "1.5px solid #DC2626",
                borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600,
                cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, alignSelf: "flex-start",
              }}
            >
              {busy ? "Revoking…" : "Revoke link"}
            </button>
          </>
        ) : (
          <button
            onClick={create}
            disabled={busy}
            style={{
              background: "var(--cc-primary)", color: "var(--cc-card)", border: "none",
              borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, alignSelf: "flex-start",
            }}
          >
            {busy ? "Creating…" : "Create share link"}
          </button>
        )}

        {error && (
          <p style={{ fontSize: 13, color: "#DC2626", margin: 0 }}>
            Something went wrong. Please try again.
          </p>
        )}
      </div>
    </Modal>
  );
}

export default function PerformanceTab({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/performance`);
      if (!res.ok) throw new Error("request failed");
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState onRetry={load} />;

  const { kpis, timeSeries, platformSplit, leaderboard, currency, spendSource } = data;

  const shareButton = (
    <button
      onClick={() => setShowShare(true)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        background: "var(--cc-card)", color: "var(--cc-primary)", border: "1.5px solid var(--cc-primary)",
        borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
      }}
    >
      <Share2 size={15} /> Share report
    </button>
  );

  if (kpis.views === 0 && leaderboard.length === 0 && timeSeries.length === 0) {
    return (
      <>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>{shareButton}</div>
        <Card variant="outlined" style={{ padding: 32 }}>
          <EmptyState
            icon={<BarChart3 size={32} color="var(--cc-text-subtle)" />}
            title="No posts yet — add posts to see performance"
            description="Once creators publish content for this campaign, performance metrics will appear here."
          />
        </Card>
        {showShare && <ShareModal campaignId={campaignId} onClose={() => setShowShare(false)} />}
      </>
    );
  }

  const engRateDisplay = kpis.engagementRate !== null ? (kpis.engagementRate * 100).toFixed(2) + "%" : "—";
  const pieData = platformSplit.filter((p) => p.views > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <style>{`
        .perf-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
        @media (min-width: 1024px) { .perf-split { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); } }
        .perf-tiles .ui-statcard { min-width: 0; }
        .perf-tiles .ui-statcard-value { overflow-wrap: anywhere; font-size: clamp(16px, 1.5vw, 22px); }
      `}</style>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>{shareButton}</div>
      <div className="rsp-grid-tiles perf-tiles">
        <StatCard value={formatNumber(kpis.views)} label="Views" icon={<Eye size={16} />} />
        <StatCard value={formatNumber(kpis.engagements)} label="Engagements" icon={<Heart size={16} />} />
        <StatCard value={engRateDisplay} label="Eng. Rate" icon={<Percent size={16} />} />
        <StatCard
          value={formatCurrencyCompact(kpis.spend, currency)}
          label={spendSource === "PAID_PAYOUTS" ? "Spend (paid)" : "Spend (budget)"}
          icon={<DollarSign size={16} />}
        />
        <StatCard
          value={`${formatCostMetric(kpis.cpm, currency)} / ${formatCostMetric(kpis.cpe, currency)}`}
          label="CPM / CPE"
          icon={<Target size={16} />}
        />
        <StatCard value={formatCurrencyCompact(kpis.emv, currency)} label="EMV" icon={<TrendingUp size={16} />} />
      </div>

      <Card variant="outlined" style={{ padding: 24 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
          Views Over Time by Platform
        </span>
        {timeSeries.length >= 3 ? (
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  {SERIES.map((s) => (
                    <linearGradient key={s.key} id={`perfGrad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
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
                  formatter={(v: any) => formatNumber(Number(v ?? 0))}
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
                    fill={`url(#perfGrad-${s.key})`}
                    strokeWidth={2}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState icon={<TrendingUp size={32} color="var(--cc-text-subtle)" />} title="Not enough data yet" description="Views over time will appear once posts accumulate a few days of metrics." />
        )}
      </Card>

      <div className="perf-split">
        <Card variant="outlined" style={{ padding: 24 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
            Views by Platform
          </span>
          {pieData.length > 0 ? (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="views"
                    nameKey="platform"
                    paddingAngle={2}
                    label={false}
                    stroke="var(--cc-card)"
                    strokeWidth={2}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.platform} fill={platformColor(entry.platform)} />
                    ))}
                  </Pie>
                  <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 12 }} formatter={(value: any) => <span style={{ color: "var(--cc-text-muted)" }}>{value}</span>} />
                  <Tooltip
                    formatter={(v: any, _n: any, item: any) => [`${formatNumber(Number(v ?? 0))} views · ${(item?.payload as PlatformSplit)?.posts ?? 0} posts`, (item?.payload as PlatformSplit)?.platform ?? ""]}
                    contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={<PieChartIcon size={32} color="var(--cc-text-subtle)" />} title="No platform data" />
          )}
        </Card>

        <Card variant="solid" noPadding style={{ overflowX: "auto" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Top Creators</span>
          </div>
          {leaderboard.length > 0 ? (
            <div style={{ minWidth: 480 }}>
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
                    <Avatar name={row.name} src={row.avatarUrl ?? undefined} size="sm" />
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{row.posts}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(row.views)}</span>
                  <Badge variant="neutral" size="sm">{row.engagementRate !== null ? (row.engagementRate * 100).toFixed(1) + "%" : "—"}</Badge>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-primary)" }}>{formatCurrency(row.emv, currency)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 24 }}>
              <EmptyState icon={<Trophy size={32} color="var(--cc-text-subtle)" />} title="No creators yet" />
            </div>
          )}
        </Card>
      </div>

      {showShare && <ShareModal campaignId={campaignId} onClose={() => setShowShare(false)} />}
    </div>
  );
}
