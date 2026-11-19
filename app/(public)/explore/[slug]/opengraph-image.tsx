import { ImageResponse } from "next/og";
import { fetchMarketplaceDetail } from "@/lib/marketplace/public";
import { formatMoney } from "../format";
import { BRAND, POWERED_BY } from "@/lib/brand";
import { OG_INK, OG_MUTED, OG_RULE, OgBrandRow, ogFonts } from "@/lib/og/brand";

export const runtime = "nodejs";
export const alt = `Creator campaign on ${BRAND.name}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await fetchMarketplaceDetail(slug);

  const title = data?.campaign.title ?? "Creator Marketplace";
  const orgName = data?.campaign.orgName ?? BRAND.name;
  const sym = data?.campaign.currencySymbol ?? "$";
  const topRate = data
    ? data.campaign.rates.reduce((m, r) => Math.max(m, r.ratePerThousand), 0)
    : 0;
  const rateHeadline =
    topRate > 0 ? `Up to ${formatMoney(topRate, sym)} per 1,000 verified views` : "Get paid per verified view";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: OG_INK,
          color: "#FFFFFF",
          fontFamily: "Satoshi",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, fontWeight: 900, color: OG_MUTED }}>{orgName}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: "-0.03em",
              maxWidth: 1040,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              padding: "12px 24px",
              borderRadius: 12,
              fontSize: 32,
              fontWeight: 900,
              background: "#FFFFFF",
              color: OG_INK,
            }}
          >
            {rateHeadline}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${OG_RULE}`,
            paddingTop: 24,
            fontSize: 24,
            fontWeight: 500,
            color: OG_MUTED,
          }}
        >
          <OgBrandRow size={44} label={POWERED_BY} />
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() }
  );
}
