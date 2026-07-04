import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Creator Marketplace — Get paid per view | Outreach AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
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
            O
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#1C2048" }}>Outreach AI</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              padding: "8px 18px",
              borderRadius: 24,
              fontSize: 22,
              fontWeight: 600,
              background: "white",
              border: "1px solid #E4E6F0",
              color: "#5B5BD6",
            }}
          >
            Creator Marketplace
          </div>
          <div style={{ fontSize: 68, fontWeight: 800, color: "#1C2048", lineHeight: 1.1, maxWidth: 900 }}>
            Get paid for every view your content earns.
          </div>
          <div style={{ fontSize: 30, color: "#9097B4", maxWidth: 820 }}>
            Browse open campaigns from brands and earn a set rate per 1,000 verified views.
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
