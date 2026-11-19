import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { LandingHeroVisual } from "./LandingHeroVisual";
import { ShortlistDemo, TrackerDemo } from "./LandingDemos";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { StageArt, type StageKey } from "./LandingStageArt";

const TITLE = `${BRAND.name} — creator campaigns from pitch to payout`;
const DESCRIPTION =
  "Campaign management for talent agencies and record labels. Brief creators, track the posts they publish, reconcile payouts against verified performance.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    images: [{ url: "/landing/og.jpg", width: 1200, height: 630, alt: BRAND.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/landing/og.jpg"],
  },
};

const STAGES: { name: string; key: StageKey; lead: string }[] = [
  { name: "Pitch", key: "pitch", lead: "Twelve pitches, one row." },
  { name: "Brief", key: "brief", lead: "Deliverables, rates and dates on the creator." },
  { name: "Live", key: "live", lead: "Posts tracked without a screenshot." },
  { name: "Track", key: "track", lead: "Every number traces back to a post." },
  { name: "Pay", key: "pay", lead: "One approval. Every creator paid." },
];

/* One line per platform the creator portal connects, worded to match the
   permissions it asks for (lib/portal/whatWeRead.ts), so the homepage a
   platform reviewer opens describes the same reads as the consent screen. */
const CONNECTIONS = [
  {
    platform: "TikTok",
    key: "TIKTOK",
    reads: "Display name, avatar, username, bio, profile link and verified badge; follower, following, like and video counts; and the view, like, comment and share counts on the creator's public videos.",
  },
  {
    platform: "Instagram",
    key: "INSTAGRAM",
    reads: "Username, profile picture, bio, follower and following counts, and recent posts with their likes and comments, plus the insights Instagram shares with the account: views, reach, shares and saves.",
  },
  {
    platform: "Facebook",
    key: "FACEBOOK",
    reads: "The Page the creator chooses: its name, picture and follower count, and its recent posts with their likes, comments, shares and views, and the comments people leave on them.",
  },
  {
    platform: "YouTube",
    key: "YOUTUBE",
    reads: "The connected channel's name, handle, picture and description, its subscriber, view and video counts, and its recent videos with their title, date, views, likes and comments.",
  },
];

export default function Home() {
  return (
    <div className="lp-page mb-page">
      <a href="#content" className="lp-skip">
        Skip to content
      </a>

      <SiteHeader onHome />

      <main id="content">
        <section className="mb-hero" aria-labelledby="hero-title">
          <div className="mb-shell mb-hero-grid">
            <div className="mb-hero-copy">
              <h1 id="hero-title" className="mb-display mb-rise">
                Run creator campaigns from pitch to payout.
              </h1>
              <p className="mb-hero-lead mb-rise mb-rise-2">
                For agencies and labels: brief creators, track their posts, pay on verified
                numbers. No spreadsheet, no screenshots.
              </p>
              <div className="mb-actions mb-rise mb-rise-3">
                <Link href="/signup" className="mb-btn mb-btn-light">
                  Create an account
                  <ArrowRight size={18} aria-hidden />
                </Link>
                <Link href="/explore" className="mb-quiet">
                  Browse open campaigns
                </Link>
              </div>
              <p className="mb-connects mb-rise mb-rise-3">
                <span>Creators connect their own</span>
                {CONNECTIONS.map((c) => (
                  <span key={c.platform} className="mb-connect">
                    <span aria-hidden className="mb-glyph"><PlatformGlyph platform={c.key} size="1rem" /></span>
                    {c.platform}
                  </span>
                ))}
              </p>
            </div>
            <div className="mb-hero-visual">
              <LandingHeroVisual />
            </div>
          </div>
        </section>

        <section id="how" className="mb-sec mb-sec-after-hero" aria-labelledby="how-title">
          <div className="mb-shell">
            <div className="mb-sec-head">
              <h2 id="how-title" className="mb-h2">
                Five stages. One record.
              </h2>
            </div>
            <ol className="mb-stages">
              {STAGES.map((s, i) => (
                <li key={s.name} className="mb-stage">
                  <span className="mb-stage-n" aria-hidden>
                    {i + 1}
                  </span>
                  <h3 className="mb-stage-name">{s.name}</h3>
                  <StageArt stage={s.key} />
                  <p className="mb-stage-text">{s.lead}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="product" className="mb-sec mb-ink" aria-labelledby="product-title">
          <div className="mb-shell">
            <div className="mb-sec-head">
              <h2 id="product-title" className="mb-h2">
                Watch the sound. Clear the shortlist.
              </h2>
            </div>
            <div className="mb-previews">
              <TrackerDemo />
              <ShortlistDemo />
            </div>
          </div>
        </section>

        <section id="accounts" className="mb-sec" aria-labelledby="accounts-title">
          <div className="mb-shell mb-split">
            <div className="mb-split-intro">
              <h2 id="accounts-title" className="mb-h2">
                Creators connect their own accounts.
              </h2>
              <p className="mb-statement">Nothing is posted on their behalf.</p>
              <details className="mb-more">
                <summary>How connecting works</summary>
                <p>
                  A creator links an account from their own portal and can disconnect it there at
                  any time. Disconnecting revokes the token with the platform and deletes it from
                  our database. We read the profile and the post performance the creator lets each
                  platform share with us, and we never publish, edit or delete anything.
                </p>
              </details>
            </div>
            <ul className="mb-reads">
              {CONNECTIONS.map((c) => (
                <li key={c.platform} className="mb-read">
                  <span aria-hidden className="mb-read-glyph">
                    <PlatformGlyph platform={c.key} size="2rem" />
                  </span>
                  <h3 className="mb-read-name">{c.platform}</h3>
                  <details className="mb-more">
                    <summary>What we read</summary>
                    <p>{c.reads}</p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mb-sec mb-ink mb-close" aria-labelledby="start-title">
          <div className="mb-shell">
            <h2 id="start-title" className="mb-display mb-close-title">
              Start with one campaign.
            </h2>
            <div className="mb-close-row">
              <div className="mb-actions">
                <Link href="/signup" className="mb-btn mb-btn-light">
                  Create an account
                  <ArrowRight size={18} aria-hidden />
                </Link>
                <Link href="/explore" className="mb-quiet">
                  Browse open campaigns
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
