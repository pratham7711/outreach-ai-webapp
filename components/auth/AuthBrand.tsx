import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { PlatformTile } from "@/components/ui/PlatformTile";

/** The signed-out pages' backdrop: the landing page's two soft glows. */
export const AUTH_BACKDROP =
  "radial-gradient(55% 60% at 0% 0%, var(--cc-landing-glow-a), transparent 70%), radial-gradient(50% 55% at 100% 0%, var(--cc-landing-glow-b), transparent 70%), radial-gradient(45% 50% at 50% 100%, var(--cc-landing-glow-c), transparent 70%), var(--cc-bg)";

/** The product mark and name, as the landing page's header draws them. */
export function AuthBrand() {
  return (
    <Link
      href="/"
      style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "var(--cc-text)", textDecoration: "none" }}
    >
      <span className="lp-brand-mark" aria-hidden>
        {BRAND.short}
      </span>
      <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.01em" }}>{BRAND.name}</span>
    </Link>
  );
}

const PLATFORMS = ["TIKTOK", "INSTAGRAM", "FACEBOOK", "YOUTUBE"];

/** The platforms a creator can connect, as marks with the landing page's line. */
export function AuthPlatforms() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {PLATFORMS.map((p) => (
          <PlatformTile key={p} platform={p} size={30} />
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--cc-landing-muted)" }}>
        Creators connect TikTok, Instagram, Facebook and YouTube
      </p>
    </div>
  );
}
