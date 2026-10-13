import Link from "next/link";
import type { ReactNode } from "react";

/**
 * "This thing does not exist", for a detail page whose record is gone.
 *
 * The campaign, creator and list pages each rendered the library's EmptyState
 * here. Its title is not a heading, so the page had no <h1>; the breadcrumb,
 * which names a detail page after its <h1>, fell back to the URL and read
 * "Campaigns > Does Not Exist"; and nothing on the page led anywhere. This
 * puts the title in an <h1> -- so the breadcrumb reads it -- and offers the
 * way back to the list the record would have been in.
 *
 * No hooks, so the root 404 (a server component) can use it as well.
 */
export type NotFoundAction = { href: string; label: string };

const linkBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 40,
  padding: "0 18px",
  borderRadius: 10,
  fontSize: "var(--cc-t-14)",
  fontWeight: "var(--cc-fw-strong)",
  textDecoration: "none",
} as const;

export function NotFoundState({
  icon,
  title,
  description,
  primary,
  secondary,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  primary: NotFoundAction;
  secondary?: NotFoundAction;
}) {
  return (
    <div
      data-state="not-found"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        maxWidth: 440,
        margin: "0 auto",
        padding: "56px 16px",
      }}
    >
      {icon ? (
        <span aria-hidden="true" style={{ color: "var(--cc-text-subtle)", marginBottom: 16, display: "inline-flex" }}>
          {icon}
        </span>
      ) : null}
      <h1
        style={{
          fontSize: "var(--cc-t-20)",
          fontWeight: 700,
          color: "var(--cc-text)",
          margin: "0 0 8px",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h1>
      <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", margin: "0 0 24px", lineHeight: 1.6 }}>
        {description}
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <Link
          href={primary.href}
          style={{ ...linkBase, background: "var(--cc-primary)", color: "var(--cc-on-primary)" }}
        >
          {primary.label}
        </Link>
        {secondary ? (
          <Link
            href={secondary.href}
            style={{
              ...linkBase,
              background: "var(--cc-card)",
              color: "var(--cc-text)",
              border: "1px solid var(--cc-border)",
            }}
          >
            {secondary.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
