import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { LandingHeroVisual } from "./LandingHeroVisual";
import { ShortlistDemo, TrackerDemo } from "./LandingDemos";

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
    tag: "Pitch",
    tone: "lp-tone-blue",
    title: "Twelve pitches, one row.",
    body:
      "You brief a shortlist, not a spreadsheet. Every creator you approach is attached to the campaign from the first message, so nothing lives in one person's inbox.",
  },
  {
    tag: "Brief",
    tone: "lp-tone-violet",
    title: "The brief stops living in six places.",
    body:
      "Deliverables, rates and deadlines attach to the creator, not to a thread. Everyone on the campaign opens the same row and sees the same numbers.",
  },
  {
    tag: "Live",
    tone: "lp-tone-pink",
    title: "Posts tracked without asking for a screenshot.",
    body:
      "The creator connects their own account once. Views, likes and comments refresh themselves against the campaign, so the status you quote a client is the status that is true.",
  },
  {
    tag: "Track",
    tone: "lp-tone-orange",
    title: "Every number traces back to a post.",
    body:
      "Client-ready reporting that reconciles, because it is built from the same rows you approved — not from a spreadsheet somebody retyped on Friday.",
  },
  {
    tag: "Pay",
    tone: "lp-tone-green",
    title: "One approval. Every creator paid.",
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
    tone: "lp-tone-blue",
    reads: "Display name, avatar, username, bio, profile link and verified badge; follower, following, like and video counts; and the view, like, comment and share counts on the creator's public videos.",
  },
  {
    platform: "Instagram",
    tone: "lp-tone-pink",
    reads: "Username, profile picture, bio, follower and following counts, and recent posts with their likes and comments, plus the insights Instagram shares with the account: views, reach, shares and saves.",
  },
  {
    platform: "Facebook",
    tone: "lp-tone-violet",
    reads: "The Page the creator chooses: its name, picture and follower count, and its recent posts with their likes, comments, shares and views, and the comments people leave on them.",
  },
  {
    platform: "YouTube",
    tone: "lp-tone-orange",
    reads: "The connected channel's name, handle, picture and description, its subscriber, view and video counts, and its recent videos with their title, date, views, likes and comments.",
  },
];

export default function Home() {
  return (
    <div className="lp-page">
      <a href="#content" className="lp-skip">
        Skip to content
      </a>

      <header className="lp-header">
        <div className="lp-shell lp-header-row">
          <div className="lp-brand">
            <span className="lp-brand-mark" aria-hidden>
              {BRAND.short}
            </span>
            <span className="lp-brand-name">
              {BRAND.name}
              <a href={BRAND.umbrellaUrl} className="lp-brand-by lp-hide-sm">
                by {BRAND.umbrella}
              </a>
            </span>
          </div>
          <nav aria-label="Primary" className="lp-nav">
            <a href="#product" className="lp-nav-link lp-hide-sm">
              Product
            </a>
            <a href="#how" className="lp-nav-link lp-hide-sm">
              How it works
            </a>
            <Link href="/explore" className="lp-nav-link lp-hide-sm">
              Marketplace
            </Link>
            <Link href="/about" className="lp-nav-link lp-hide-sm">
              About
            </Link>
            <Link href="/privacy" className="lp-nav-link lp-hide-sm">
              Privacy
            </Link>
            <Link href="/terms" className="lp-nav-link lp-hide-sm">
              Terms
            </Link>
            <Link href="/login" className="lp-nav-link" data-strong>
              Sign in
            </Link>
            <Link href="/signup" className="lp-btn lp-btn-primary lp-btn-sm">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main id="content">
        <section className="lp-hero-wrap lp-hero" aria-labelledby="hero-title">
          <div className="lp-shell rsp-hero">
            <div>
              <p className="lp-eyebrow lp-rise">
                <span className="lp-eyebrow-dot" aria-hidden />
                Campaign management for agencies and labels
              </p>
              <h1 id="hero-title" className="lp-h1 lp-rise lp-rise-2">
                Run creator campaigns <span className="lp-grad-text">from pitch to payout.</span>
              </h1>
              <p className="lp-lead lp-rise lp-rise-2">
                Talent agencies and record labels brief creators, track the posts those creators
                publish, and reconcile payouts against verified performance — in one place,
                instead of a spreadsheet and a folder of screenshots.
              </p>
              <div className="lp-cta-row lp-rise lp-rise-3">
                <Link href="/signup" className="lp-btn lp-btn-primary">
                  Create an account
                  <ArrowRight size={18} aria-hidden />
                </Link>
                <Link href="/explore" className="lp-btn lp-btn-ghost">
                  Browse open campaigns
                </Link>
              </div>
              <div className="lp-platforms lp-rise lp-rise-4">
                <span>Creators connect</span>
                {CONNECTIONS.map((c) => (
                  <span key={c.platform} className={`lp-chip ${c.tone}`}>
                    <span className="lp-dot" aria-hidden />
                    {c.platform}
                  </span>
                ))}
              </div>
            </div>
            <LandingHeroVisual />
          </div>
        </section>

        <section id="product" className="lp-section" aria-labelledby="product-title">
          <div className="lp-shell">
            <p className="lp-kicker lp-tone-violet">Inside the app</p>
            <h2 id="product-title" className="lp-h2">
              Watch the sound. Clear the shortlist.
            </h2>
            <p className="lp-section-lead">
              Two previews of the app, filled with invented demo data. The controls work — change
              the window, approve a creator.
            </p>
            <div className="lp-bento">
              <TrackerDemo />
              <ShortlistDemo />
            </div>
          </div>
        </section>

        <section id="how" className="lp-section lp-section-tight" aria-labelledby="how-title">
          <div className="lp-shell lp-how">
            <div className="lp-how-head">
              <p className="lp-kicker lp-tone-blue">How a campaign runs</p>
              <h2 id="how-title" className="lp-h2">
                Five stages, one record.
              </h2>
              <p className="lp-section-lead">
                Each stage adds to the same campaign, so the numbers you report and the payouts
                you approve come from the same rows.
              </p>
            </div>
            <ol className="lp-steps">
              {STAGES.map((s, i) => (
                <li key={s.tag} className={`lp-step ${s.tone}`}>
                  <span className="lp-step-marker" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="lp-step-body">
                    <p className="lp-step-tag">{s.tag}</p>
                    <h3 className="lp-h3">{s.title}</h3>
                    <p className="lp-step-text">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="accounts" className="lp-section lp-section-tight" aria-labelledby="accounts-title">
          <div className="lp-shell">
            <p className="lp-kicker lp-tone-green">
              <ShieldCheck size={16} aria-hidden />
              Connected accounts
            </p>
            <h2 id="accounts-title" className="lp-h2">
              Creators connect their own accounts. Nothing is posted on their behalf.
            </h2>
            <p className="lp-section-lead">
              A creator links an account from their own portal, and can disconnect it there at
              any time. Disconnecting revokes the token with the platform and deletes it from
              our database. We read the profile and the post performance the creator lets each
              platform share with us — we never publish, edit or delete anything.
            </p>
            <ul className="lp-accounts">
              {CONNECTIONS.map((c) => (
                <li key={c.platform} className={`lp-card lp-account ${c.tone}`}>
                  <h3 className="lp-account-name">
                    <span className="lp-dot" aria-hidden />
                    {c.platform}
                  </h3>
                  <p className="lp-account-label">What we read</p>
                  <p className="lp-account-text">{c.reads}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-section-tight" aria-labelledby="start-title">
          <div className="lp-shell">
            <div className="lp-band">
              <h2 id="start-title" className="lp-band-title">
                Start with one campaign.
              </h2>
              <p className="lp-band-text">
                Create an account, add a campaign, and send creators a link to connect their
                accounts.
              </p>
              <div className="lp-cta-row">
                <Link href="/signup" className="lp-btn lp-btn-on-band">
                  Create an account
                  <ArrowRight size={18} aria-hidden />
                </Link>
                <Link href="/explore" className="lp-btn lp-btn-outline-band">
                  Browse open campaigns
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-shell lp-footer-row">
          <div>
            <p className="lp-brand">
              <span className="lp-brand-mark" aria-hidden>
                {BRAND.short}
              </span>
              <span className="lp-brand-name">{BRAND.name}</span>
            </p>
            <p className="lp-footer-note">
              A <a href={BRAND.umbrellaUrl}>{BRAND.umbrella}</a> product. {BRAND.jurisdiction}.
            </p>
          </div>
          <nav aria-label="Footer" className="lp-footer-nav">
            <Link href="/privacy" className="lp-nav-link">
              Privacy Policy
            </Link>
            <Link href="/terms" className="lp-nav-link">
              Terms of Service
            </Link>
            <Link href="/data-deletion" className="lp-nav-link">
              Data deletion
            </Link>
            <Link href="/about" className="lp-nav-link">
              About
            </Link>
            <a href={`mailto:${BRAND.contactEmail}`} className="lp-nav-link">
              Contact
            </a>
            <Link href="/login" className="lp-nav-link">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
