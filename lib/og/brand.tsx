import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND } from "@/lib/brand";

export const OG_INK = "#0B0B0B";
export const OG_MUTED = "rgba(255,255,255,0.7)";
export const OG_RULE = "#2A2A2A";

/* Satori reads TTF/OTF/WOFF, not WOFF2, so these are TTF copies of the
   site's Satoshi files. next.config traces lib/og/*.ttf into the routes. */
export async function ogFonts() {
  const dir = join(process.cwd(), "lib/og");
  const [medium, black] = await Promise.all([
    readFile(join(dir, "satoshi-500.ttf")),
    readFile(join(dir, "satoshi-900.ttf")),
  ]);
  return [
    { name: "Satoshi", data: medium, weight: 500 as const, style: "normal" as const },
    { name: "Satoshi", data: black, weight: 900 as const, style: "normal" as const },
  ];
}

/** The MB mark as it sits on ink: white square, ink letters. */
export function OgMark({ size = 64 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        background: "#FFFFFF",
        color: OG_INK,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 900,
        letterSpacing: "-0.02em",
      }}
    >
      {BRAND.short}
    </div>
  );
}

export function OgBrandRow({ size = 64, label = BRAND.name }: { size?: number; label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: Math.round(size * 0.47), fontWeight: 900 }}>
      <OgMark size={size} />
      {label}
    </div>
  );
}
