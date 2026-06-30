"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, Badge, StatCard, EmptyState, Input, Tag, Avatar } from "@pratham7711/ui";
import type { Recipient, RecipientStats } from "@/lib/recipients/aggregate";

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
  return new Date(iso).toLocaleDateString();
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
    <div className="cc-page-content">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
          Recipients
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Everyone you've paid, with totals derived from payout history
        </p>
      </div>

      <div className="cc-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
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
              icon="📬"
              title="No recipients yet"
              description="Recipients appear here once you've processed payouts to your creators."
            />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 24px" }}>
            <EmptyState icon="🔍" title="No matches" description="No recipients match your search." />
          </div>
        ) : (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 160px 120px 120px 120px 90px",
                gap: 12,
                padding: "12px 24px",
                borderBottom: "1px solid var(--cc-border)",
                background: "var(--cc-bg)",
              }}
            >
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
                  className="cc-table-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 160px 120px 120px 120px 90px",
                    gap: 12,
                    padding: "14px 24px",
                    alignItems: "center",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Avatar name={r.name} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{r.name}</p>
                      <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                        {r.handle ? `@${r.handle}` : r.paypalEmail ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
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
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(r.totalPaid)}</span>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                    {r.pending > 0 ? (
                      <Badge variant="warning" dot>
                        {formatCurrency(r.pending)}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatDate(r.lastPayoutAt)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{r.payoutCount}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
