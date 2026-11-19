import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { StageArt, type StageKey } from "@/app/LandingStageArt";

const STACK: { key: StageKey; n: string; label: string }[] = [
  { key: "live", n: "03", label: "Live" },
  { key: "track", n: "04", label: "Track" },
  { key: "pay", n: "05", label: "Pay" },
];

const PLATFORMS = [
  { key: "TIKTOK", label: "TikTok" },
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "FACEBOOK", label: "Facebook" },
  { key: "YOUTUBE", label: "YouTube" },
];

/** The ink half of the agency sign-in and sign-up pages, drawn like the homepage hero. */
export function AuthShowcase() {
  return (
    <aside className="cc-auth-show">
      <Link href="/" className="mb-brand cc-auth-show__brand">
        <span className="mb-mark" aria-hidden>
          {BRAND.short}
        </span>
        <span className="mb-brand-name">{BRAND.name}</span>
      </Link>

      <div className="cc-auth-show__body">
        <p className="cc-auth-show__title">Run creator campaigns from pitch to payout.</p>
        <ol className="cc-auth-show__stack" aria-hidden>
          {STACK.map((s) => (
            <li key={s.key}>
              <span className="cc-auth-show__label">
                {s.n} {s.label}
              </span>
              <StageArt stage={s.key} />
            </li>
          ))}
        </ol>
      </div>

      <p className="mb-connects cc-auth-show__connects">
        Creators connect their own
        {PLATFORMS.map((p) => (
          <span key={p.key} className="mb-connect">
            <span aria-hidden className="mb-glyph">
              <PlatformGlyph platform={p.key} size="1rem" />
            </span>
            {p.label}
          </span>
        ))}
      </p>
    </aside>
  );
}
