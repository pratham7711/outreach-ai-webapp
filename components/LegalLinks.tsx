import type React from "react";
import Link from "next/link";

const LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/data-deletion", label: "Data deletion" },
];

const LINK_STYLE: React.CSSProperties = {
  color: "var(--cc-text-muted)",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

/**
 * Privacy Policy · Terms of Service · Data deletion, in the page's own flow.
 *
 * Meta and TikTok reviewers check that the policies are one tap away from
 * every screen that asks a creator to sign in or connect an account, without
 * opening a menu: the creator portal and an agency's connect link.
 */
export function LegalLinks({ style }: { style?: React.CSSProperties }) {
  return (
    <nav
      aria-label="Legal"
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "4px 16px",
        fontSize: 12,
        ...style,
      }}
    >
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} style={LINK_STYLE}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The agreement line under a Connect YouTube button. YouTube API Services
 * policy III.A.2 asks that a user agree to the privacy policy before using
 * the client's features, and III.A.1 that they be bound by YouTube's terms.
 */
export function YouTubeConnectAgreement({ style }: { style?: React.CSSProperties }) {
  return (
    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--cc-text-muted)", ...style }}>
      By connecting, you agree to our{" "}
      <Link href="/terms" style={LINK_STYLE}>
        Terms
      </Link>{" "}
      and{" "}
      <Link href="/privacy" style={LINK_STYLE}>
        Privacy Policy
      </Link>{" "}
      and to the{" "}
      <a href="https://www.youtube.com/t/terms" style={LINK_STYLE}>
        YouTube Terms of Service
      </a>
      .
    </p>
  );
}
