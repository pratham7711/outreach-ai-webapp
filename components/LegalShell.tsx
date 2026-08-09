import React from "react";
import Link from "next/link";

export const LEGAL = {
  name: "Outreach AI",
  entity: "Outreach AI",
  privacyEmail: "privacy@prathamsharma.in",
  contactEmail: "hello@prathamsharma.in",
  updated: "10 August 2026",
};

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--cc-text)",
          marginBottom: 12,
        }}
      >
        {heading}
      </h2>
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--cc-text)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function LegalShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main style={{ background: "var(--cc-bg)", minHeight: "100vh" }}>
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "56px 24px 96px",
        }}
      >
        <Link
          href="/"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--cc-primary)",
            textDecoration: "none",
          }}
        >
          {LEGAL.name}
        </Link>

        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "var(--cc-text)",
            margin: "20px 0 8px",
          }}
        >
          {title}
        </h1>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 24 }}>
          Last updated {LEGAL.updated}
        </p>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: "var(--cc-text)",
            marginBottom: 40,
            paddingBottom: 32,
            borderBottom: "1px solid var(--cc-border)",
          }}
        >
          {intro}
        </p>

        {children}

        <nav
          style={{
            marginTop: 48,
            paddingTop: 24,
            borderTop: "1px solid var(--cc-border)",
            display: "flex",
            gap: 20,
            fontSize: 13,
          }}
        >
          <Link href="/privacy" style={{ color: "var(--cc-primary)", textDecoration: "none" }}>
            Privacy Policy
          </Link>
          <Link href="/terms" style={{ color: "var(--cc-primary)", textDecoration: "none" }}>
            Terms of Service
          </Link>
          <a
            href={`mailto:${LEGAL.contactEmail}`}
            style={{ color: "var(--cc-primary)", textDecoration: "none" }}
          >
            Contact
          </a>
        </nav>
      </div>
    </main>
  );
}
