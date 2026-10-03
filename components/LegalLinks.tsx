import type React from "react";
import Link from "next/link";

const LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/data-deletion", label: "Data deletion" },
];

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
        <Link key={link.href} href={link.href} style={{ color: "var(--cc-text-muted)", textDecoration: "underline", textUnderlineOffset: 2 }}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
