"use client";
import { ComingSoon, PageHeader } from "@/components/ds";

export default function FanPagesPage() {
  return (
    <div className="rsp-page">
      <PageHeader title="Fan pages" subtitle="Build custom fan pages for creators" />
      <ComingSoon
        feature="Fan pages"
        note="Fan pages are coming. They will appear here once they are ready."
      />
    </div>
  );
}
