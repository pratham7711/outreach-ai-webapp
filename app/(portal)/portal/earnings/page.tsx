"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Badge, Button, StatCard, EmptyState, Skeleton } from "@pratham7711/ui";
import { toast } from "sonner";
import { Wallet, Clock, Info } from "lucide-react";

type CampaignEarning = {
  campaignId: string;
  title: string;
  slug: string | null;
  orgName: string;
  currency: string;
  approvedMinor: number;
  pendingMinor: number;
  minPayoutMinor: number | null;
  submissionCount: number;
  canRequestPayout: boolean;
};

function fmtMoney(minor: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export default function PortalEarningsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignEarning[]>([]);
  const [totalApprovedMinor, setTotalApprovedMinor] = useState(0);
  const [totalPendingMinor, setTotalPendingMinor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestingId, setRequestingId] = useState<string | null>(null);

  const fetchEarnings = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/earnings");
      if (res.status === 401) {
        router.push("/portal/login");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns ?? []);
        setTotalApprovedMinor(data.totalApprovedMinor ?? 0);
        setTotalPendingMinor(data.totalPendingMinor ?? 0);
      } else {
        setError("Failed to load earnings");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  const requestPayout = async (c: CampaignEarning) => {
    setRequestingId(c.campaignId);
    try {
      const res = await fetch("/api/portal/payout-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: c.campaignId,
          requestedAmount: c.approvedMinor / 100,
          currency: c.currency,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Payout request submitted");
      } else {
        toast.error(data.error ?? "Failed to request payout");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setRequestingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
        <Skeleton width="200px" height="32px" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginTop: 24 }}>
          {[1, 2].map((i) => (
            <Skeleton key={i} height="80px" borderRadius="10px" />
          ))}
        </div>
        <Skeleton width="100%" height="300px" borderRadius="12px" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Earnings</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Your accrued marketplace earnings across campaigns.</p>
      </div>

      {/* Manual-fulfillment notice */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 14px", borderRadius: 8, background: "rgba(91,91,214,0.06)", border: "1px solid var(--cc-border)", marginBottom: 24 }}>
        <Info size={16} style={{ color: "var(--cc-primary)", flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
          Earnings are computed automatically from your approved submissions. Payouts are fulfilled manually by the campaign owner for now.
        </span>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEE2E2", color: "#DC2626", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Totals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard value={fmtMoney(totalApprovedMinor)} label="Available balance (approved)" icon={<Wallet size={18} />} />
        <StatCard value={fmtMoney(totalPendingMinor)} label="Pending review" icon={<Clock size={18} />} />
      </div>

      {campaigns.length === 0 && !error ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState
            icon="💰"
            title="No earnings yet"
            description="Join a campaign and submit content to start accruing earnings."
            action={
              <Link href="/portal/campaigns">
                <Button variant="primary">My Campaigns</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {campaigns.map((c) => {
            const threshold = c.minPayoutMinor;
            const pct = threshold && threshold > 0 ? Math.min(100, (c.approvedMinor / threshold) * 100) : 100;
            return (
              <Card key={c.campaignId} variant="solid" style={{ padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {c.slug ? (
                        <Link href={`/portal/campaigns/${c.slug}`} style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", textDecoration: "none" }}>
                          {c.title}
                        </Link>
                      ) : (
                        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>{c.title}</span>
                      )}
                      <Badge variant="neutral">{c.orgName}</Badge>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2 }}>
                      {c.submissionCount} submission{c.submissionCount === 1 ? "" : "s"}
                      {c.pendingMinor > 0 ? ` · ${fmtMoney(c.pendingMinor, c.currency)} pending` : ""}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{fmtMoney(c.approvedMinor, c.currency)}</p>
                    <p style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>approved</p>
                  </div>
                </div>

                {/* Min-payout threshold indicator */}
                {threshold && threshold > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 6, borderRadius: 3, background: "var(--cc-bg)", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "#059669" : "var(--cc-primary)", transition: "width 0.2s" }} />
                    </div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-muted)", marginTop: 4 }}>
                      {c.canRequestPayout
                        ? "Minimum payout threshold reached"
                        : `${fmtMoney(c.approvedMinor, c.currency)} of ${fmtMoney(threshold, c.currency)} minimum`}
                    </p>
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <Button
                    variant="primary"
                    disabled={!c.canRequestPayout || requestingId === c.campaignId}
                    loading={requestingId === c.campaignId}
                    onClick={() => requestPayout(c)}
                  >
                    Request payout
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
