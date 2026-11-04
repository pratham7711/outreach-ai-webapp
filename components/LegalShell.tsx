import React from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BRAND } from "@/lib/brand";

export const LEGAL = {
  name: BRAND.name,
  entity: BRAND.legalEntity,
  privacyEmail: BRAND.privacyEmail,
  contactEmail: BRAND.contactEmail,
  updated: BRAND.updated,
};

function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function LegalSection({
  heading,
  id,
  children,
}: {
  heading: string;
  /** An anchor, for a section another page links to directly. */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id ?? slug(heading)} className="legal-section">
      <h2 className="legal-h2">{heading}</h2>
      <div className="legal-prose">{children}</div>
    </section>
  );
}

/** One platform inside a policy list: its mark in brand colour beside the text. */
export function LegalPlatform({ mark, children }: { mark: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="legal-platform">
      {mark}
      <div className="legal-platform-body">{children}</div>
    </li>
  );
}

const PAGES = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/data-deletion", label: "Data deletion" },
];

export function LegalShell({
  title,
  intro,
  dated = true,
  highlights,
  children,
}: {
  title: string;
  intro: string;
  /** False on a page that is not a policy, such as About, so it does not
      carry the policies' "Last updated" date. */
  dated?: boolean;
  /** A few lines the page already states, repeated as a summary up top. */
  highlights?: { icon: LucideIcon; text: string }[];
  children: React.ReactNode;
}) {
  const sections = React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ heading?: string; id?: string }>(child) && typeof child.props.heading === "string"
      ? [{ id: child.props.id ?? slug(child.props.heading), heading: child.props.heading }]
      : []
  );

  return (
    <main className="legal-page">
      <header className="legal-top">
        <div className="legal-top-row">
          <Link href="/" className="legal-brand">
            <span className="lp-brand-mark" aria-hidden>
              {BRAND.short}
            </span>
            <span className="legal-brand-name">{LEGAL.name}</span>
          </Link>
          <nav aria-label="Policies" className="legal-top-nav">
            {PAGES.map((p) => (
              <Link key={p.href} href={p.href}>
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="legal-hero">
        <div className="legal-hero-inner">
          <h1 className="legal-h1">{title}</h1>
          {dated && (
            <p className="legal-updated">
              <CalendarDays size={15} aria-hidden="true" />
              Last updated {LEGAL.updated}
            </p>
          )}
          <p className="legal-intro">{intro}</p>
          {highlights && highlights.length > 0 && (
            <ul className="legal-highlights" aria-label="In short">
              {highlights.map(({ icon: Icon, text }) => (
                <li key={text}>
                  <span className="legal-highlight-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="legal-body">
        {sections.length > 2 && (
          <aside className="legal-toc" aria-label="On this page">
            <p className="legal-toc-title">On this page</p>
            <ol>
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.heading}</a>
                </li>
              ))}
            </ol>
          </aside>
        )}
        <article className="legal-article">
          {children}

          <nav className="legal-foot" aria-label="Policies and contact">
            {PAGES.map((p) => (
              <Link key={p.href} href={p.href}>
                {p.label === "Privacy" ? "Privacy Policy" : p.label === "Terms" ? "Terms of Service" : p.label}
              </Link>
            ))}
            <a href={`mailto:${LEGAL.contactEmail}`}>Contact</a>
          </nav>
        </article>
      </div>
    </main>
  );
}
