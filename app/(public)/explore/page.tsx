import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, Skeleton } from "@pratham7711/ui";
import { fetchMarketplaceList, type SortKey } from "@/lib/marketplace/public";
import MarketplaceFilters from "./MarketplaceFilters";
import CampaignCard from "./CampaignCard";

export const metadata: Metadata = {
  title: "Creator Marketplace — Get paid per view | Outreach AI",
  description:
    "Browse open campaigns from top brands and get paid for every verified view. Join content-reward campaigns on TikTok, Instagram, and YouTube.",
  openGraph: {
    title: "Creator Marketplace — Get paid per view",
    description:
      "Browse open campaigns from top brands and get paid for every verified view.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Creator Marketplace — Get paid per view",
    description:
      "Browse open campaigns from top brands and get paid for every verified view.",
  },
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: 16,
};

function CardsSkeleton() {
  return (
    <div style={gridStyle}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 16,
            padding: 20,
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <Skeleton width="120px" height="20px" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Skeleton width="80%" height="24px" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <Skeleton width="60%" height="16px" />
          </div>
          <Skeleton width="50%" height="16px" />
        </div>
      ))}
    </div>
  );
}

async function MarketplaceGrid({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = parseInt(first(searchParams.page) ?? "1", 10) || 1;

  const { campaigns, pagination } = await fetchMarketplaceList({
    q: first(searchParams.q),
    platform: first(searchParams.platform),
    type: first(searchParams.type),
    sort: (first(searchParams.sort) as SortKey) ?? undefined,
    page,
    pageSize: 12,
  });

  if (campaigns.length === 0) {
    return (
      <div style={{ padding: "48px 0" }}>
        <EmptyState
          title="No campaigns found"
          description="Try clearing your filters or check back soon — new campaigns are added every day."
        />
      </div>
    );
  }

  // Build page links preserving current filters.
  const params = new URLSearchParams();
  for (const key of ["q", "platform", "type", "sort"]) {
    const v = first(searchParams[key]);
    if (v) params.set(key, v);
  }
  const pageHref = (p: number) => {
    const usp = new URLSearchParams(params);
    if (p > 1) usp.set("page", String(p));
    const qs = usp.toString();
    return qs ? `/explore?${qs}` : "/explore";
  };

  return (
    <>
      <div style={gridStyle}>
        {campaigns.map((c) => (
          <CampaignCard key={c.slug} campaign={c} />
        ))}
      </div>

      {pagination.totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            marginTop: 32,
          }}
        >
          {pagination.page > 1 ? (
            <Link href={pageHref(pagination.page - 1)} style={pagerLinkStyle}>
              ← Prev
            </Link>
          ) : (
            <span style={pagerDisabledStyle}>← Prev</span>
          )}
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          {pagination.page < pagination.totalPages ? (
            <Link href={pageHref(pagination.page + 1)} style={pagerLinkStyle}>
              Next →
            </Link>
          ) : (
            <span style={pagerDisabledStyle}>Next →</span>
          )}
        </div>
      )}
    </>
  );
}

const pagerLinkStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--cc-border)",
  background: "var(--cc-card)",
  color: "var(--cc-text)",
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
};

const pagerDisabledStyle: React.CSSProperties = {
  ...pagerLinkStyle,
  color: "var(--cc-text-subtle)",
  cursor: "default",
};

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
      {/* Hero */}
      <div
        style={{
          background: "linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 45%, #FFFFFF 100%)",
          borderBottom: "1px solid var(--cc-border)",
        }}
      >
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "56px 20px 40px" }}>
          <span
            style={{
              display: "inline-block",
              padding: "5px 12px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              color: "var(--cc-primary)",
              marginBottom: 16,
            }}
          >
            Creator Marketplace
          </span>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: "var(--cc-text)",
              margin: "0 0 12px",
              lineHeight: 1.15,
              maxWidth: 680,
            }}
          >
            Get paid for every view your content earns.
          </h1>
          <p
            style={{
              fontSize: 16,
              color: "var(--cc-text-muted)",
              margin: 0,
              maxWidth: 560,
              lineHeight: 1.6,
            }}
          >
            Browse open campaigns from brands, post your content, and earn a set rate per
            1,000 verified views. No follower minimums.
          </p>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 20px 80px" }}>
        <Suspense fallback={<div style={{ height: 48, marginBottom: 24 }} />}>
          <MarketplaceFilters />
        </Suspense>
        <Suspense fallback={<CardsSkeleton />}>
          {/* key forces re-suspense on filter change */}
          <MarketplaceGrid
            key={JSON.stringify(sp)}
            searchParams={sp}
          />
        </Suspense>

        <div style={{ textAlign: "center", padding: "48px 0 0" }}>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Powered by Outreach AI</p>
        </div>
      </div>
    </div>
  );
}
