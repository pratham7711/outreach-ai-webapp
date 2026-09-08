"use client";
import { ComingSoon, PageHeader } from "@/components/ds";

export default function FanPagesPage() {
  return (
    <div className="rsp-page">
      <PageHeader title="Fan Pages" subtitle="Build custom fan pages for creators" />
      <ComingSoon
        feature="Fan Pages"
        note="Migrating from CreatorCore? Fan Pages will land here before your migration completes."
      />
    </div>
  );
}
