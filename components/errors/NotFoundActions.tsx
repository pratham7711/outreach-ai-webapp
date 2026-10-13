"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NotFoundAction } from "./NotFoundState";

/**
 * Where the 404 page sends you, by who you are and where you were.
 *
 * It used to say "Go to Dashboard" to everyone. A logged-out visitor on a dead
 * public link (/c/<missing>, /invite/<bad>) was sent to the agency dashboard,
 * which bounced them to an agency login they have no account for; a creator on
 * /portal/<missing> was sent out of the portal into the agency app.
 *
 * Who is signed in is read on the server (the root 404 has the cookies); the
 * path is read here, because a server 404 is not told which URL missed.
 */
export function notFoundActions(
  pathname: string,
  signedIn: { agency: boolean; creator: boolean },
): { primary: NotFoundAction; secondary?: NotFoundAction } {
  const inPortal = pathname === "/portal" || pathname.startsWith("/portal/");
  if (inPortal) {
    return signedIn.creator
      ? { primary: { href: "/portal/dashboard", label: "Go to your portal" } }
      : { primary: { href: "/portal/login", label: "Sign in to the portal" } };
  }
  if (signedIn.agency) return { primary: { href: "/dashboard", label: "Go to Dashboard" } };
  if (signedIn.creator) return { primary: { href: "/portal/dashboard", label: "Go to your portal" } };
  return {
    primary: { href: "/", label: "Go to the home page" },
    secondary: { href: "/login", label: "Sign in" },
  };
}

const linkBase = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 24px",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
} as const;

export function NotFoundActions({ agency, creator }: { agency: boolean; creator: boolean }) {
  const pathname = usePathname() ?? "";
  const { primary, secondary } = notFoundActions(pathname, { agency, creator });
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
      <Link href={primary.href} style={{ ...linkBase, background: "var(--cc-primary)", color: "var(--cc-on-primary)" }}>
        {primary.label}
      </Link>
      {secondary ? (
        <Link
          href={secondary.href}
          style={{ ...linkBase, background: "var(--cc-card)", color: "var(--cc-text)", border: "1px solid var(--cc-border)" }}
        >
          {secondary.label}
        </Link>
      ) : null}
    </div>
  );
}
