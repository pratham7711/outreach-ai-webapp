"use client";
import { ComingSoon } from "@/components/ds";

export default function FanPagesPage() {
  return (
    <div className="rsp-page">
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Fan Pages</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Build custom fan pages for creators</p>
      </div>
      <ComingSoon
        feature="Fan Pages"
        note="Migrating from CreatorCore? Fan Pages will land here before your migration completes."
      />
    </div>
  );
}
