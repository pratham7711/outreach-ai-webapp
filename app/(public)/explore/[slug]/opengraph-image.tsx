import { ImageResponse } from "next/og";
import { fetchMarketplaceDetail } from "@/lib/marketplace/public";
import { formatMoney } from "../format";

export const runtime = "nodejs";
export const alt = "Creator campaign on Outreach AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await fetchMarketplaceDetail(slug);

  const title = data?.campaign.title ?? "Creator Marketplace";
  const orgName = data?.campaign.orgName ?? "Outreach AI";
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
          padding: 72,
          background: "linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 45%, #FFFFFF 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#5B5BD6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 30,
              fontWeight: 800,
            }}
          >
            {orgName.charAt(0).toUpperCase()}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#1C2048" }}>{orgName}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 66, fontWeight: 800, color: "#1C2048", lineHeight: 1.1, maxWidth: 980 }}>
            {title}
          </div>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              padding: "12px 24px",
              borderRadius: 16,
              fontSize: 34,
              fontWeight: 700,
              background: "#5B5BD6",
              color: "white",
            }}
          >
            {rateHeadline}
          </div>
        </div>

        <div style={{ fontSize: 26, fontWeight: 600, color: "#9097B4" }}>
          Powered by Outreach AI
        </div>
      </div>
    ),
    { ...size }
  );
}
