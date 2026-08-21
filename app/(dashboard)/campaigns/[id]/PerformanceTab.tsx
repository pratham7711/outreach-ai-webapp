"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Card, Badge, EmptyState, Skeleton, Avatar, Modal, Button } from "@pratham7711/ui";
import { MetricTile } from "@/components/ds";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Eye, Heart, Percent, DollarSign, Target, TrendingUp, Share2, AlertTriangle, BarChart3, PieChart as PieChartIcon, Trophy, Download } from "lucide-react";
import { formatCompact } from "@/lib/format";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import { SHARE_PLATFORMS, type SharePlatform, type ShareVisibility } from "@/lib/reports/shareVisibility";

type Kpis = {
  views: number;
  /** null when no post in the campaign has had its engagement fetched. */
  engagements: number | null;
  engagementRate: number | null;
  emv: number;
};

const LEADERBOARD_COLS = (withEngagement: boolean) =>
  withEngagement ? "1fr 70px 90px 80px 90px" : "1fr 70px 90px 90px";

type TimeSeriesPoint = { date: string; TIKTOK: number; INSTAGRAM: number; YOUTUBE: number };
type PlatformSplit = { platform: string; views: number; posts: number };
type LeaderboardRow = {
  creatorId: string;
  name: string;
  avatarUrl: string | null;
  posts: number;
  views: number;
  engagements: number | null;
  engagementRate: number | null;
  emv: number;
};

type PerformanceData = {
  currency: string;
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

type ShareLink = {
  token: string;
  isPublic: boolean;
  createdAt: string;
  path: string;
  visibility: ShareVisibility;
};

const PLATFORM_LABELS: Record<SharePlatform, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
};

/** A row of the visibility panel. Label is clickable, which the bare input is not. */
function VisibilityToggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: "var(--cc-primary)", cursor: "inherit" }}
      />
      <span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{label}</span>
        {hint && (
          <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)", lineHeight: 1.5 }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

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

  /* PATCH, not POST: POST rotates the token, and nobody toggling "show budget"
     is asking to break a URL they have already sent. The checkbox is optimistic
     and rolls back on failure, so it never shows a setting the link is not
     actually serving. */
  const setVisibility = async (next: ShareVisibility) => {
    if (!link) return;
    const previous = link.visibility;
    setLink({ ...link, visibility: next });
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) throw new Error("failed");
      const json = await res.json();
      if (json.link) setLink(json.link);
    } catch {
      setLink((current) => (current ? { ...current, visibility: previous } : current));
      setError(true);
    }
  };

  const togglePlatform = (platform: SharePlatform, on: boolean) => {
    if (!link) return;
    const current = link.visibility.platforms;
    // Empty means "no restriction", so unchecking the last box would silently
    // widen the report to everything. Keep the other two explicitly instead.
    const next = on
      ? [...current.filter((p) => p !== platform), platform]
      : (current.length ? current : [...SHARE_PLATFORMS]).filter((p) => p !== platform);
    setVisibility({ ...link.visibility, platforms: next });
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
            <div
              style={{
                background: "var(--cc-bg)", border: "1px solid var(--cc-border)",
                borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cc-text-subtle)", marginBottom: 8 }}>
                  Platforms included
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                  {SHARE_PLATFORMS.map((p) => {
                    const selected = link.visibility.platforms.length
                      ? link.visibility.platforms
                      : [...SHARE_PLATFORMS];
                    const on = selected.includes(p);
                    return (
                      <VisibilityToggle
                        key={p}
                        checked={on}
                        // Unchecking the last one would store an empty list,
                        // which means "no restriction" — the opposite of asking
                        // for nothing. One platform has to stay on.
                        disabled={on && selected.length === 1}
                        onChange={(next) => togglePlatform(p, next)}
                        label={PLATFORM_LABELS[p]}
                      />
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cc-text-subtle)" }}>
                  What the recipient sees
                </div>
                <VisibilityToggle
                  checked={link.visibility.showCreators}
                  onChange={(next) => setVisibility({ ...link.visibility, showCreators: next })}
                  label="Creator leaderboard"
                  hint="Names, post counts and views per creator."
                />
                <VisibilityToggle
                  checked={link.visibility.showEmv}
                  onChange={(next) => setVisibility({ ...link.visibility, showEmv: next })}
                  label="Earned media value"
                  hint="The EMV tile and the per-creator EMV column."
                />
                <VisibilityToggle
                  checked={link.visibility.showBudget}
                  onChange={(next) => setVisibility({ ...link.visibility, showBudget: next })}
                  label="Total budget"
                  hint="Off by default — a brand does not see it unless you turn it on."
                />
                <VisibilityToggle
                  checked={link.visibility.showStatuses}
                  onChange={(next) => setVisibility({ ...link.visibility, showStatuses: next })}
                  label="Creator statuses"
                  hint="Where each activation stands, including who declined. Off by default."
                />
              </div>
            </div>

            <button
              onClick={revoke}
              disabled={busy}
              style={{
                background: "var(--cc-card)", color: "var(--status-critical)", border: "1.5px solid var(--status-critical)",
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
          <p style={{ fontSize: 13, color: "var(--status-critical)", margin: 0 }}>
            Something went wrong. Please try again.
          </p>
        )}
      </div>
    </Modal>
  );
}

type ExportFormat = "xlsx" | "csv" | "pdf";

const EXPORT_FORMATS: { key: ExportFormat; label: string; hint: string }[] = [
  { key: "xlsx", label: "Excel (.xlsx)", hint: "Summary, posts, creators and payouts as separate sheets" },
  { key: "csv", label: "CSV (.csv)", hint: "Same sections in one plain-text file" },
  { key: "pdf", label: "PDF (.pdf)", hint: "Formatted performance report" },
];

function ExportModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>("xlsx");

  const download = () => {
    window.location.assign(`/api/campaigns/${campaignId}/export?format=${format}`);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Export campaign data"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" iconLeft={<Download size={15} />} onClick={download}>Download</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.6 }}>
          Download the latest data for this campaign in your preferred format.
        </p>
        {EXPORT_FORMATS.map((f) => {
          const selected = f.key === format;
          return (
            <button
              key={f.key}
              onClick={() => setFormat(f.key)}
              aria-pressed={selected}
              style={{
                textAlign: "left", cursor: "pointer", borderRadius: 8, padding: 12,
                background: selected ? "var(--cc-bg)" : "var(--cc-card)",
                border: selected ? "1.5px solid var(--cc-primary)" : "1px solid var(--cc-border)",
              }}
            >
              <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{f.label}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)", marginTop: 4 }}>{f.hint}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export default function PerformanceTab({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showExport, setShowExport] = useState(false);

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

  const { kpis, timeSeries, platformSplit, leaderboard, currency } = data;

  const headerActions = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Button variant="secondary" iconLeft={<Download size={15} />} onClick={() => setShowExport(true)}>
        Export
      </Button>
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
    </div>
  );

  if (kpis.views === 0 && leaderboard.length === 0 && timeSeries.length === 0) {
    return (
      <>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>{headerActions}</div>
        <Card variant="outlined" style={{ padding: 32 }}>
          <EmptyState
            icon={<BarChart3 size={32} color="var(--cc-text-subtle)" />}
            title="No posts yet — add posts to see performance"
            description="Once creators publish content for this campaign, performance metrics will appear here."
          />
        </Card>
        {showShare && <ShareModal campaignId={campaignId} onClose={() => setShowShare(false)} />}
        {showExport && <ExportModal campaignId={campaignId} onClose={() => setShowExport(false)} />}
      </>
    );
  }

  const pieData = platformSplit.filter((p) => p.views > 0);
  /* Every post here carries a view count; engagement only exists for the ones we
     fetched ourselves, so those tiles appear only when there is something in
     them. See lib/metricDisplay. */
  const anyEngagementMeasured = leaderboard.some((r) => r.engagementRate !== null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <style>{`
        .perf-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
        @media (min-width: 1024px) { .perf-split { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); } }
        .perf-tiles .ui-statcard { min-width: 0; }
        .perf-tiles .ui-statcard-value { overflow-wrap: anywhere; font-size: clamp(16px, 1.5vw, 22px); }
      `}</style>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>{headerActions}</div>
      <div className="rsp-grid-tiles perf-tiles">
        <MetricTile metric="views" value={formatNumber(kpis.views)} />
        {kpis.engagements !== null && (
          <MetricTile metric="engagements" value={formatNumber(kpis.engagements)} />
        )}
        {kpis.engagementRate !== null && (
          <MetricTile
            metric="engagementRate"
            label="Eng. rate"
            value={`${(kpis.engagementRate * 100).toFixed(2)}%`}
          />
        )}
        <MetricTile metric="emv" value={formatCurrencyCompact(kpis.emv, currency)} />
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
                display: "grid", gridTemplateColumns: LEADERBOARD_COLS(anyEngagementMeasured),
                gap: 12, padding: "10px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
              }}>
                {["Creator", "Posts", "Views", ...(anyEngagementMeasured ? ["Eng."] : []), "EMV"].map((h) => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                ))}
              </div>
              {leaderboard.map((row, i) => (
                <div
                  key={row.creatorId}
                  style={{
                    display: "grid", gridTemplateColumns: LEADERBOARD_COLS(anyEngagementMeasured), gap: 12,
                    padding: "12px 24px", alignItems: "center",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <Avatar name={row.name} src={row.avatarUrl ?? undefined} size="sm" />
                    <span title={row.name} style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{row.posts}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(row.views)}</span>
                  {anyEngagementMeasured && (
                    <span>
                      {row.engagementRate !== null && (
                        <Badge variant="neutral" size="sm">{(row.engagementRate * 100).toFixed(1)}%</Badge>
                      )}
                    </span>
                  )}
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
      {showExport && <ExportModal campaignId={campaignId} onClose={() => setShowExport(false)} />}
    </div>
  );
}
