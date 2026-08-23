"use client";

import React, { useEffect, useState } from "react";
import { Badge, Card, Skeleton } from "@pratham7711/ui";
import { MetricTile } from "@/components/ds";
import { formatDateAbs } from "@/lib/format";

/**
 * The reference's Financials sub-tab, read only.
 *
 * It shows Budget & Overview over two rollup tiles, then Payments and Payouts.
 * The reference also offers "Add Payment" and "Add Payout" here; those are
 * deliberately absent. Payments are parked in this app, and a tab that reports
 * money is a different decision from a tab that moves it -- so this reads the
 * figures that already exist and creates nothing.
 *
 * Payments come from the campaign's deposit. The reference keeps a list and we
 * hold at most one (CampaignDeposit.campaignId is unique), so one deposit is
 * rendered as a one-row list rather than reshaped into something else.
 */

type Deposit = {
  id: string;
  amountRequested: number;
  amountUsd: number;
  currency: string;
  gateway: string;
  method: string | null;
  status: string;
  releasedAmount: number;
  createdAt: string;
};

type Payout = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod: string;
  createdAt: string;
  completedAt: string | null;
  creator: { id: string; name: string; handle: string } | null;
};

export type CampaignFinancialsProps = {
  campaignId: string;
  budget: number | null;
  currency: string;
  notes: string | null;
  creatorRateTotals: number | null;
  profitTotal: number | null;
  /** The CampaignFinancials row, when one exists. */
  financials: { totalBudget: number; spentAmount: number; notes: string | null } | null;
};

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral" | "accent"> = {
  SUCCESS: "success",
  RELEASED: "success",
  PAID: "success",
  PENDING: "warning",
  PROCESSING: "accent",
  FAILED: "danger",
  REFUNDED: "neutral",
};

function money(amount: number | null | undefined, currency: string): string {
  // The reference prints $0.00 rather than a dash, so a real zero reads as a
  // measured zero. Only a genuinely absent figure falls back.
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", marginBottom: 12 }}>{title}</h3>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <p style={{ fontSize: 15, color: "var(--cc-text-muted)", padding: "4px 0" }}>{children}</p>
    </Card>
  );
}

const ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.4fr 120px 130px 130px 120px",
  gap: 12,
  padding: "12px 20px",
  alignItems: "center",
  fontSize: 13,
};

export default function FinancialsTab({
  campaignId,
  budget,
  currency,
  notes,
  creatorRateTotals,
  profitTotal,
  financials,
}: CampaignFinancialsProps) {
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      // Both are read-only GETs, and a failure on either leaves that section
      // empty rather than taking down the tab: a missing deposit is the normal
      // case, not an error worth interrupting the figures above for.
      const [dep, pay] = await Promise.all([
        fetch(`/api/campaigns/${campaignId}/deposits`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/payouts?campaignId=${encodeURIComponent(campaignId)}&limit=100`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (!live) return;
      setDeposit(dep?.deposit ?? null);
      setPayouts(pay?.payouts ?? []);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [campaignId]);

  // The campaign's own budget is what the header edits; CampaignFinancials
  // carries a second figure. Prefer the campaign's, fall back to the row.
  const totalBudget = budget ?? financials?.totalBudget ?? null;
  const shownNotes = notes ?? financials?.notes ?? null;

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16 }}>Budget &amp; Overview</h3>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 15, color: "var(--cc-text-muted)", marginBottom: 4 }}>Total Budget</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>{money(totalBudget, currency)}</div>
            </div>
            <div>
              <div style={{ fontSize: 15, color: "var(--cc-text-muted)", marginBottom: 4 }}>Notes</div>
              <div style={{ fontSize: 14, color: shownNotes ? "var(--cc-text)" : "var(--cc-text-muted)", whiteSpace: "pre-wrap" }}>
                {shownNotes || "No notes on this campaign."}
              </div>
            </div>
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <MetricTile label="Creator Rate Totals" value={money(creatorRateTotals ?? 0, currency)} />
          <MetricTile label="Total Profit" value={money(profitTotal ?? 0, currency)} />
        </div>
      </div>

      <Section title="Payments">
        {loading ? (
          <Skeleton height={64} />
        ) : !deposit ? (
          <Empty>No payments created for this campaign!</Empty>
        ) : (
          <Card className="overflow-hidden py-0">
            <div style={{ ...ROW, fontWeight: 600, color: "var(--cc-text-muted)", borderBottom: "1px solid var(--cc-border)" }}>
              <span>Gateway</span>
              <span>Amount</span>
              <span>Released</span>
              <span>Created</span>
              <span>Status</span>
            </div>
            <div style={ROW}>
              <span style={{ color: "var(--cc-text)" }}>
                {deposit.gateway}
                {deposit.method ? ` · ${deposit.method}` : ""}
              </span>
              <span>{money(deposit.amountRequested, deposit.currency)}</span>
              <span>{money(deposit.releasedAmount, deposit.currency)}</span>
              <span>{formatDateAbs(deposit.createdAt)}</span>
              <span>
                <Badge variant={STATUS_VARIANT[deposit.status] ?? "neutral"}>{deposit.status}</Badge>
              </span>
            </div>
          </Card>
        )}
      </Section>

      <Section title="Payouts">
        {loading ? (
          <Skeleton height={64} />
        ) : payouts.length === 0 ? (
          <Empty>No payouts created for this campaign!</Empty>
        ) : (
          <Card className="overflow-hidden py-0">
            <div style={{ ...ROW, fontWeight: 600, color: "var(--cc-text-muted)", borderBottom: "1px solid var(--cc-border)" }}>
              <span>Creator</span>
              <span>Amount</span>
              <span>Method</span>
              <span>Created</span>
              <span>Status</span>
            </div>
            {payouts.map((p, i) => (
              <div key={p.id} style={{ ...ROW, borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}>
                <span style={{ color: "var(--cc-text)" }}>{p.creator?.name || p.creator?.handle || "—"}</span>
                <span>{money(p.amount, p.currency)}</span>
                <span>{p.paymentMethod}</span>
                <span>{formatDateAbs(p.createdAt)}</span>
                <span>
                  <Badge variant={STATUS_VARIANT[p.status] ?? "neutral"}>{p.status}</Badge>
                </span>
              </div>
            ))}
          </Card>
        )}
      </Section>
    </div>
  );
}
