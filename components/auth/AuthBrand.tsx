import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { PlatformTile } from "@/components/ui/PlatformTile";

/** The signed-out pages' backdrop: the landing page's two soft glows. */
export const AUTH_BACKDROP =
  "radial-gradient(55% 60% at 0% 0%, var(--cc-landing-glow-a), transparent 70%), radial-gradient(50% 55% at 100% 0%, var(--cc-landing-glow-b), transparent 70%), radial-gradient(45% 50% at 50% 100%, var(--cc-landing-glow-c), transparent 70%), var(--cc-bg)";

/** The product mark and name, as the landing page's header draws them. */
export function AuthBrand() {
  return (
    <Link href="/" className="cc-auth-brand">
      <span className="lp-brand-mark" aria-hidden>
        {BRAND.short}
      </span>
      <span className="cc-auth-brand__name">{BRAND.name}</span>
    </Link>
  );
}

const PLATFORMS = ["TIKTOK", "INSTAGRAM", "FACEBOOK", "YOUTUBE"];

/** The platforms a creator can connect, as marks with the landing page's line. */
export function AuthPlatforms() {
  return (
    <div className="cc-auth-platforms">
      <div className="cc-auth-platforms__marks">
        {PLATFORMS.map((p) => (
          <PlatformTile key={p} platform={p} size={30} />
        ))}
      </div>
      <p className="cc-auth-platforms__line">Creators connect TikTok, Instagram, Facebook and YouTube</p>
    </div>
  );
}
