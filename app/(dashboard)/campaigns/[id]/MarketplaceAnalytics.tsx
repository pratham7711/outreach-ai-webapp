"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Card, EmptyState, Skeleton } from "@pratham7711/ui";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

type Analytics = {
  visibility: "PRIVATE" | "GLOBAL" | "INVITE_ONLY";
  joinsOverTime: { date: string; joins: number; cumulative: number }[];
  submissionsByStatus: { status: string; count: number }[];
  budget: {
    accruedMajor: number;
    capMajor: number | null;
    fraction: number | null;
    capReached: boolean;
  };
  projectedExhaustionDate: string | null;
  totals: { joins: number; submissions: number };
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PENDING_REVIEW: { label: "Pending", color: "#D97706", bg: "#FEF3C7" },
  APPROVED: { label: "Approved", color: "#059669", bg: "#D1FAE5" },
  REJECTED: { label: "Rejected", color: "#DC2626", bg: "#FEE2E2" },
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return String(num);
}

function formatCurrency(n: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function MarketplaceAnalytics({
  campaignId,
  currency = "USD",
}: {
  campaignId: string;
  currency?: string;
}) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/marketplace-analytics`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Card variant="outlined" style={{ padding: 24 }}>
        <Skeleton width="180px" height="18px" />
        <div style={{ marginTop: 16 }}>
          <Skeleton width="100%" height="240px" borderRadius="12px" />
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card variant="outlined" style={{ padding: 32 }}>
        <EmptyState
          icon="⚠️"
          title="Couldn't load marketplace analytics"
          description="Something went wrong while fetching marketplace analytics."
          action={
            <button
              onClick={load}
              style={{
                background: "var(--cc-primary)", color: "white", border: "none",
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

  const { budget } = data;
  const pct = budget.fraction != null ? Math.round(budget.fraction * 100) : null;
  const eta = data.projectedExhaustionDate
    ? new Date(data.projectedExhaustionDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`
        .mkt-an-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
        @media (min-width: 1024px) { .mkt-an-split { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); } }
      `}</style>

      {/* Header stat tiles */}
      <div className="rsp-grid-tiles">
        <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-card)", border: "1px solid var(--cc-border)" }}>
          <div style={statLabelStyle}>Creators joined</div>
          <div style={statValueStyle}>{formatNumber(data.totals.joins)}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-card)", border: "1px solid var(--cc-border)" }}>
          <div style={statLabelStyle}>Submissions</div>
          <div style={statValueStyle}>{formatNumber(data.totals.submissions)}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-card)", border: "1px solid var(--cc-border)" }}>
          <div style={statLabelStyle}>Accrued</div>
          <div style={statValueStyle}>{formatCurrency(budget.accruedMajor, currency)}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 10, background: "var(--cc-card)", border: "1px solid var(--cc-border)" }}>
          <div style={statLabelStyle}>Budget cap</div>
          <div style={statValueStyle}>{budget.capMajor != null ? formatCurrency(budget.capMajor, currency) : "—"}</div>
        </div>
      </div>

      <div className="mkt-an-split">
        {/* Joins over time chart */}
        <Card variant="outlined" style={{ padding: 24 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
            Creators joined over time
          </span>
          {data.joinsOverTime.length > 0 ? (
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.joinsOverTime}>
                  <defs>
                    <linearGradient id="mktJoins" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--cc-primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--cc-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
                  <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                  <Tooltip
                    labelFormatter={(l) => formatDate(String(l))}
                    contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12 }}
                  />
                  <Area type="monotone" dataKey="cumulative" name="Total joined" stroke="var(--cc-primary)" strokeWidth={2} fill="url(#mktJoins)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon="👥" title="No joins yet" description="Creator joins will appear here once they enroll." />
          )}
        </Card>

        {/* Right column: submissions by status + budget bar */}
        <Card variant="outlined" style={{ padding: 24 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
            Submissions by status
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {data.submissionsByStatus.map((s) => {
              const meta = STATUS_META[s.status] ?? { label: s.status, color: "var(--cc-text)", bg: "var(--cc-bg)" };
              return (
                <div key={s.status} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: meta.color, background: meta.bg, padding: "3px 10px", borderRadius: 6 }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(s.count)}</span>
                </div>
              );
            })}
          </div>

          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--cc-text)", display: "block", marginBottom: 8 }}>
            Budget accrued vs cap
          </span>
          {pct != null ? (
            <>
              <div style={{ height: 10, borderRadius: 6, background: "var(--cc-border)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: budget.capReached ? "#DC2626" : "var(--cc-primary)", borderRadius: 6 }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 6 }}>
                {pct}% of pool {budget.capReached ? "— cap reached" : "claimed"}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>No budget cap set.</div>
          )}

          <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 16 }}>
            Projected exhaustion:{" "}
            <span style={{ fontWeight: 700, color: "var(--cc-text)" }}>{eta ?? "—"}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

const statLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cc-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: "var(--cc-text)",
};
