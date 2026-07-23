"use client";

import { useMemo, useState } from "react";
import { Search, Mailbox } from "lucide-react";
import { Card, Badge, StatCard, EmptyState, Input, Tag, Avatar } from "@pratham7711/ui";
import type { Recipient, RecipientStats } from "@/lib/recipients/aggregate";
import { stripAt } from "@/lib/format";

const METHOD_LABELS: Record<string, string> = {
  PAYPAL: "PayPal",
  BANK_TRANSFER: "Bank transfer",
  UPI: "UPI",
  NEFT: "NEFT",
  IMPS: "IMPS",
  RTGS: "RTGS",
  ENACH: "eNACH",
  WIRE: "Wire",
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatMethod(method: string) {
  return METHOD_LABELS[method] ?? method.replace(/_/g, " ").toLowerCase();
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function RecipientsClient({
  recipients,
  stats,
}: {
  recipients: Recipient[];
  stats: RecipientStats;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.handle ?? "").toLowerCase().includes(q) ||
        (r.paypalEmail ?? "").toLowerCase().includes(q),
    );
  }, [recipients, search]);

  return (
    <div className="rsp-page">
      <style>{`
        .rsp-grid-tiles .ui-statcard { min-width: 0; }
        .rsp-grid-tiles .ui-statcard-value { overflow-wrap: anywhere; font-size: clamp(17px, 5vw, 30px); }
        .recip-inner { min-width: 730px; }
        .recip-head, .recip-row { display: grid; grid-template-columns: 1fr 160px 120px 120px 120px 90px; gap: 12px; align-items: center; }
        .recip-head { padding: 12px 24px; border-bottom: 1px solid var(--cc-border); background: var(--cc-bg); }
        .recip-row { padding: 14px 24px; }
        @media (max-width: 767px) {
          .recip-inner { min-width: 0; }
          .recip-head { display: none; }
          .recip-row { display: flex; flex-wrap: wrap; align-items: center; column-gap: 12px; row-gap: 8px; padding: 14px 16px; }
          .recip-row > [data-col="recipient"] { order: 1; flex: 1 1 auto; min-width: 0; }
          .recip-row > [data-col="paid"] { order: 2; margin-left: auto; }
          .recip-row > [data-col="methods"] { order: 3; flex-basis: 100%; }
          .recip-row > [data-col="pending"] { order: 4; }
          .recip-row > [data-col="last"] { order: 5; margin-left: auto; }
          .recip-row > [data-col="count"] { order: 6; flex-basis: 100%; color: var(--cc-text-muted); font-weight: 400; }
          .recip-row > [data-col="count"]::before { content: "Payouts · "; }
        }
      `}</style>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
          Recipients
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Everyone you've paid, with totals derived from payout history
        </p>
      </div>

      <div className="cc-stagger rsp-grid-tiles" style={{ marginBottom: 32 }}>
        <StatCard value={String(stats.recipientCount)} label="Recipients" />
        <StatCard value={formatCurrency(stats.totalPaid)} label="Total Paid" />
        <StatCard value={formatCurrency(stats.totalPending)} label="Pending" />
        <StatCard value={formatCurrency(stats.totalFailed)} label="Failed" />
      </div>

      <div style={{ marginBottom: 24 }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search recipients..."
          iconLeft={<Search size={16} />}
        />
      </div>

      <Card variant="solid" noPadding>
        {recipients.length === 0 ? (
          <div style={{ padding: "48px 24px" }}>
            <EmptyState
              icon={<Mailbox size={32} color="var(--cc-text-subtle)" />}
              title="No recipients yet"
              description="Recipients appear here once you've processed payouts to your creators."
            />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 24px" }}>
            <EmptyState icon={<Search size={32} color="var(--cc-text-subtle)" />} title="No matches" description="No recipients match your search." />
          </div>
        ) : (
          <div className="rsp-table-wrap">
            <div className="recip-inner">
            <div className="recip-head">
              {["Recipient", "Methods", "Total Paid", "Pending", "Last Paid", "Payouts"].map((h) => (
                <span
                  key={h}
                  style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}
                >
                  {h}
                </span>
              ))}
            </div>
            <div className="cc-stagger">
              {filtered.map((r, i) => (
                <div
                  key={r.creatorId}
                  className="cc-table-row recip-row"
                  style={{
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <div data-col="recipient" style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <Avatar name={r.name} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{r.name}</p>
                      <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                        {r.handle ? `@${stripAt(r.handle)}` : r.paypalEmail ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div data-col="methods" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {r.paymentMethods.length === 0 ? (
                      <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>—</span>
                    ) : (
                      r.paymentMethods.map((m) => (
                        <Tag key={m} variant="neutral" outlined>
                          {formatMethod(m)}
                        </Tag>
                      ))
                    )}
                  </div>
                  <span data-col="paid" style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(r.totalPaid)}</span>
                  <span data-col="pending" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                    {r.pending > 0 ? (
                      <Badge variant="warning" dot>
                        {formatCurrency(r.pending)}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span data-col="last" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatDate(r.lastPayoutAt)}</span>
                  <span data-col="count" style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{r.payoutCount}</span>
                </div>
              ))}
            </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
