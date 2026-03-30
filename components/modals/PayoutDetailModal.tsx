"use client";

import { Modal, Button, Badge, Avatar } from "@pratham7711/ui";
import { ArrowRight, ExternalLink } from "lucide-react";

type Payout = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod: string;
  recipientPaypalEmail: string | null;
  transactionId: string | null;
  failureReason: string | null;
  createdAt: string;
  initiatedAt: string;
  completedAt: string | null;
  creator: { id: string; name: string; handle: string; platform: string; contactEmail?: string };
  campaign: { id: string; title: string } | null;
};

const STATUS_VARIANT: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  PROCESSING: "neutral",
  SUCCESS: "success",
  FAILED: "danger",
};

const NEXT_STATUS: Record<string, { label: string; status: string; variant: "primary" | "success" | "danger" }[]> = {
  PENDING: [
    { label: "Mark Paid", status: "SUCCESS", variant: "success" },
    { label: "Mark Processing", status: "PROCESSING", variant: "primary" },
  ],
  PROCESSING: [
    { label: "Mark Paid", status: "SUCCESS", variant: "success" },
    { label: "Mark Failed", status: "FAILED", variant: "danger" },
  ],
  FAILED: [{ label: "Retry (Back to Pending)", status: "PENDING", variant: "primary" }],
};

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function PayoutDetailModal({
  payout,
  onClose,
  onStatusChange,
}: {
  payout: Payout;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const actions = NEXT_STATUS[payout.status] ?? [];

  const detailRow = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--cc-border)" }}>
      <span style={{ fontSize: 13, color: "var(--cc-text-muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--cc-text)", fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Payout Details" size="md">
      {/* Creator header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "12px 16px", background: "var(--cc-bg)", borderRadius: 10 }}>
        <Avatar name={payout.creator.name} size="md" />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>{payout.creator.name}</p>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{payout.creator.handle} · {payout.creator.platform}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: 20, fontWeight: 800, color: "var(--cc-text)" }}>{formatCurrency(payout.amount, payout.currency)}</p>
          <Badge variant={STATUS_VARIANT[payout.status] ?? "neutral"} dot>{payout.status}</Badge>
        </div>
      </div>

      {/* Details */}
      <div style={{ marginBottom: 20 }}>
        {detailRow("Campaign", payout.campaign?.title ?? "No campaign")}
        {detailRow("Payment Method", payout.paymentMethod)}
        {payout.recipientPaypalEmail && detailRow("PayPal Email", payout.recipientPaypalEmail)}
        {payout.transactionId && detailRow("Transaction ID", payout.transactionId)}
        {detailRow("Initiated", formatDate(payout.initiatedAt))}
        {detailRow("Completed", formatDate(payout.completedAt))}
        {payout.failureReason && detailRow("Failure Reason", <span style={{ color: "#DC2626" }}>{payout.failureReason}</span>)}
      </div>

      {/* Status Timeline */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, justifyContent: "center" }}>
        {["PENDING", "PROCESSING", "SUCCESS"].map((s, i) => {
          const isActive = s === payout.status;
          const isPast = ["PENDING", "PROCESSING", "SUCCESS"].indexOf(payout.status) > i;
          const isFailed = payout.status === "FAILED" && s === "PROCESSING";
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700,
                background: isActive ? "var(--cc-primary)" : isPast ? "#10B981" : isFailed ? "#DC2626" : "var(--cc-border)",
                color: isActive || isPast || isFailed ? "white" : "var(--cc-text-muted)",
              }}>
                {isPast ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 11, color: isActive ? "var(--cc-text)" : "var(--cc-text-muted)", fontWeight: isActive ? 600 : 400 }}>{s}</span>
              {i < 2 && <ArrowRight size={14} style={{ color: "var(--cc-text-subtle)" }} />}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {actions.map((a) => (
            <Button
              key={a.status}
              variant={a.variant === "success" ? "primary" : a.variant === "danger" ? "danger" : "primary"}
              size="sm"
              onClick={() => onStatusChange(payout.id, a.status)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </Modal>
  );
}
