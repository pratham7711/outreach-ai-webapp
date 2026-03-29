"use client";
import { EmptyState } from "@pratham7711/ui";

export default function RecipientsPage() {
  return (
    <div className="cc-page-content">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Recipients</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Manage your payment recipients</p>
      </div>
      <EmptyState
        icon="📬"
        title="Coming soon"
        description="Recipient management is under development."
      />
    </div>
  );
}
