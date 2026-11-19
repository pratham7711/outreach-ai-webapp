import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { LandingHeroVisual } from "./LandingHeroVisual";
import { ShortlistDemo, TrackerDemo } from "./LandingDemos";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";

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

const STAGES = [
  {
    name: "Pitch",
    lead: "Twelve pitches, one row.",
    body:
      "You brief a shortlist, not a spreadsheet. Every creator you approach is attached to the campaign from the first message, so nothing lives in one person's inbox.",
  },
  {
    name: "Brief",
    lead: "The brief stops living in six places.",
    body:
      "Deliverables, rates and deadlines attach to the creator, not to a thread. Everyone on the campaign opens the same row and sees the same numbers.",
  },
  {
    name: "Live",
    lead: "Posts tracked without asking for a screenshot.",
    body:
      "The creator connects their own account once. Views, likes and comments refresh themselves against the campaign, so the status you quote a client is the status that is true.",
  },
  {
    name: "Track",
    lead: "Every number traces back to a post.",
    body:
      "Client-ready reporting that reconciles, because it is built from the same rows you approved, not from a spreadsheet somebody retyped on Friday.",
  },
  {
    name: "Pay",
    lead: "One approval. Every creator paid.",
    body:
      "The ledger closes itself. What you approved is what left the account, to the rupee, with a record against the creator who earned it.",
  },
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
                Talent agencies and record labels brief creators, track the posts those creators
                publish, and reconcile payouts against verified performance. One place, instead
                of a spreadsheet and a folder of screenshots.
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
            <div className="mb-sec-head mb-sec-head-split">
              <h2 id="how-title" className="mb-h2">
                Five stages. One record.
              </h2>
              <p className="mb-lead">
                Each stage adds to the same campaign, so the numbers you report and the payouts
                you approve come from the same rows.
              </p>
            </div>
            <ol className="mb-stages">
              {STAGES.map((s, i) => (
                <li key={s.name} className="mb-stage">
                  <span className="mb-stage-n" aria-hidden>
                    {i + 1}
                  </span>
                  <h3 className="mb-stage-name">{s.name}</h3>
                  <p className="mb-stage-text">
                    <strong>{s.lead}</strong> {s.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="product" className="mb-sec mb-ink" aria-labelledby="product-title">
          <div className="mb-shell">
            <div className="mb-sec-head mb-sec-head-split">
              <h2 id="product-title" className="mb-h2">
                Watch the sound. Clear the shortlist.
              </h2>
              <p className="mb-lead">
                Two screens from the app, filled with invented demo data. The controls work:
                change the window, approve a creator.
              </p>
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
              <p className="mb-lead">
                Nothing is posted on their behalf. A creator links an account from their own
                portal and can disconnect it there at any time. Disconnecting revokes the token
                with the platform and deletes it from our database. We read the profile and the
                post performance the creator lets each platform share with us, and we never
                publish, edit or delete anything.
              </p>
            </div>
            <ul className="mb-reads">
              {CONNECTIONS.map((c) => (
                <li key={c.platform} className="mb-read">
                  <h3 className="mb-read-name">
                    <span aria-hidden className="mb-glyph"><PlatformGlyph platform={c.key} size="1.25rem" /></span>
                    {c.platform}
                  </h3>
                  <p className="mb-read-label">What we read</p>
                  <p className="mb-read-text">{c.reads}</p>
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
              <p className="mb-lead">
                Create an account, add a campaign, and send creators a link to connect their
                accounts.
              </p>
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
