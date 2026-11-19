import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";
import { OG_INK, OG_MUTED, OG_RULE, OgBrandRow, ogFonts } from "@/lib/og/brand";

export const runtime = "nodejs";
export const alt = `Creator Marketplace — Get paid per view | ${BRAND.name}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
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
        <OgBrandRow />
        <div
          style={{
            display: "flex",
            fontSize: 84,
            fontWeight: 900,
            lineHeight: 0.94,
            letterSpacing: "-0.035em",
            textTransform: "uppercase",
            maxWidth: 1000,
          }}
        >
          Get paid for every view your content earns.
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${OG_RULE}`,
            paddingTop: 26,
            fontSize: 26,
            fontWeight: 500,
            color: OG_MUTED,
          }}
        >
          <span>Creator Marketplace</span>
          <span>{`${BRAND.domain}/explore`}</span>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() }
  );
}
