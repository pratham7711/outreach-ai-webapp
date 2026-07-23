"use client";
import { EmptyState } from "@pratham7711/ui";
import { Mic } from "lucide-react";

export default function FanPagesPage() {
  return (
    <div className="rsp-page">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Fan Pages</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Build custom fan pages for creators</p>
      </div>
      <EmptyState
        icon={<Mic size={32} color="var(--cc-text-subtle)" />}
        title="Coming soon"
        description="Fan page builder is under development."
      />
    </div>
  );
}
