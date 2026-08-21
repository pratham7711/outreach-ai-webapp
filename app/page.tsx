import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { LandingHeroVisual } from "./LandingHeroVisual";

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
    marker: "01 / Pitch",
    title: "Twelve pitches, one row.",
    body:
      "You brief a shortlist, not a spreadsheet. Every creator you approach is attached to the campaign from the first message, so nothing lives in one person's inbox.",
  },
  {
    marker: "02 / Brief",
    title: "The brief stops living in six places.",
    body:
      "Deliverables, rates and deadlines attach to the creator, not to a thread. Everyone on the campaign opens the same row and sees the same numbers.",
  },
  {
    marker: "03 / Live",
    title: "Posts tracked without asking for a screenshot.",
    body:
      "The creator connects their own account once. Views, likes and comments refresh themselves against the campaign, so the status you quote a client is the status that is true.",
  },
  {
    marker: "04 / Track",
    title: "Every number traces back to a post.",
    body:
      "Client-ready reporting that reconciles, because it is built from the same rows you approved — not from a spreadsheet somebody retyped on Friday.",
  },
  {
    marker: "05 / Pay",
    title: "One approval. Every creator paid.",
    body:
      "The ledger closes itself. What you approved is what left the account, to the rupee, with a record against the creator who earned it.",
  },
];

const CONNECTIONS = [
  {
    platform: "TikTok",
    reads: "Display name and avatar, follower count, and the public view, like, comment and share counts on the videos the creator published for the campaign.",
  },
  {
    platform: "Instagram",
    reads: "Profile handle and the public engagement counts on the posts delivered against a brief.",
  },
  {
    platform: "YouTube",
    reads: "Channel name and the public view and engagement counts on the videos delivered against a brief.",
  },
];

const shell: React.CSSProperties = {
  maxWidth: 1080,
  margin: "0 auto",
  padding: "0 24px",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "var(--cc-text-muted)",
  marginBottom: 16,
};

export default function Home() {
  return (
    <main style={{ background: "var(--cc-bg)", minHeight: "100vh" }}>
      <header
        style={{
          borderBottom: "1px solid var(--cc-border)",
          background: "var(--cc-card)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            ...shell,
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>
              {BRAND.name}
            </span>
            <a
              href={BRAND.umbrellaUrl}
              className="rsp-hide-mobile"
              style={{
                fontSize: 12,
                color: "var(--cc-text-muted)",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              by {BRAND.umbrella}
            </a>
          </div>
          <nav style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 14 }}>
            <Link
              href="/explore"
              className="rsp-hide-mobile"
              style={{ color: "var(--cc-text-muted)", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              Marketplace
            </Link>
            <Link href="/login" style={{ color: "var(--cc-text)", textDecoration: "none", fontWeight: 600 }}>
              Sign in
            </Link>
            <Link
              href="/signup"
              style={{
                background: "var(--cc-primary)",
                color: "white",
                borderRadius: 8,
                padding: "9px 16px",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <section
        style={{
          ...shell,
          paddingTop: 80,
          paddingBottom: 64,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 40,
          alignItems: "center",
        }}
        className="rsp-hero"
      >
        <div>
        <p style={sectionLabel}>Campaign management for agencies and labels</p>
        <h1
          style={{
            fontSize: 48,
            lineHeight: 1.1,
            fontWeight: 700,
            color: "var(--cc-text)",
            maxWidth: 720,
            marginBottom: 20,
          }}
        >
          Run creator campaigns from pitch to payout.
        </h1>
        <p
          style={{
            fontSize: 18,
            lineHeight: 1.6,
            color: "var(--cc-text-muted)",
            maxWidth: 620,
            marginBottom: 32,
          }}
        >
          Talent agencies and record labels brief creators, track the posts those creators
          publish, and reconcile payouts against verified performance — in one place,
          instead of a spreadsheet and a folder of screenshots.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="/signup"
            style={{
              background: "var(--cc-primary)",
              color: "white",
              borderRadius: 8,
              padding: "13px 24px",
              fontSize: 15,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Create an account
          </Link>
          <Link
            href="/explore"
            style={{
              background: "var(--cc-card)",
              color: "var(--cc-primary)",
              border: "1.5px solid var(--cc-primary)",
              borderRadius: 8,
              padding: "13px 24px",
              fontSize: 15,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Browse open campaigns
          </Link>
        </div>
        </div>
        <LandingHeroVisual />
      </section>

      <section style={{ ...shell, paddingBottom: 72 }}>
        <p style={sectionLabel}>How a campaign runs</p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {STAGES.map((s) => (
            <article
              key={s.marker}
              style={{
                background: "var(--cc-card)",
                border: "1px solid var(--cc-border)",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  color: "var(--cc-primary)",
                  marginBottom: 12,
                }}
              >
                {s.marker}
              </p>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--cc-text)",
                  marginBottom: 8,
                  lineHeight: 1.35,
                }}
              >
                {s.title}
              </h2>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--cc-text-muted)" }}>
                {s.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ ...shell, paddingBottom: 72 }}>
        <p style={sectionLabel}>Connected accounts</p>
        <h2
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "var(--cc-text)",
            marginBottom: 12,
            maxWidth: 720,
          }}
        >
          Creators connect their own accounts. Nothing is posted on their behalf.
        </h2>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: "var(--cc-text-muted)",
            maxWidth: 720,
            marginBottom: 24,
          }}
        >
          A creator links an account from their own portal, and can disconnect it there at
          any time. Disconnecting revokes the token with the platform and deletes it from
          our database. We read public performance data for the posts delivered against a
          campaign — we never publish, edit or delete anything.
        </p>
        <div
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {CONNECTIONS.map((c, i) => (
            <div
              key={c.platform}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: 16,
                padding: 20,
                borderTop: i === 0 ? "none" : "1px solid var(--cc-border)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>
                {c.platform}
              </span>
              <span style={{ fontSize: 14, lineHeight: 1.65, color: "var(--cc-text-muted)" }}>
                {c.reads}
              </span>
            </div>
          ))}
        </div>
      </section>

      <footer
        style={{
          borderTop: "1px solid var(--cc-border)",
          background: "var(--cc-card)",
          padding: "40px 0",
        }}
      >
        <div
          style={{
            ...shell,
            display: "flex",
            flexWrap: "wrap",
            gap: 24,
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
              {BRAND.name}
            </p>
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
              A{" "}
              <a href={BRAND.umbrellaUrl} style={{ color: "var(--cc-primary)", textDecoration: "none" }}>
                {BRAND.umbrella}
              </a>{" "}
              product. {BRAND.jurisdiction}.
            </p>
          </div>
          <nav style={{ display: "flex", flexWrap: "wrap", gap: 24, fontSize: 14 }}>
            <Link href="/privacy" style={{ color: "var(--cc-primary)", textDecoration: "none" }}>
              Privacy Policy
            </Link>
            <Link href="/terms" style={{ color: "var(--cc-primary)", textDecoration: "none" }}>
              Terms of Service
            </Link>
            <a
              href={`mailto:${BRAND.contactEmail}`}
              style={{ color: "var(--cc-primary)", textDecoration: "none" }}
            >
              Contact
            </a>
            <Link href="/login" style={{ color: "var(--cc-primary)", textDecoration: "none" }}>
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
