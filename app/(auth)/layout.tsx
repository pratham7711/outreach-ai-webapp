import Link from "next/link";
import { BRAND } from "@/lib/brand";

const linkStyle: React.CSSProperties = {
  color: "var(--cc-text-muted)",
  textDecoration: "none",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* In the flow, after the page, not fixed over it. Fixed, it covered the
          bottom 43px of a screen nothing had reserved -- 17.8px of the Create
          account button at 1440x900 and 77px of a 390px phone (MEASURED
          2026-10-02). Every auth page is at least a screen tall, so the links
          are one short scroll away. */}
      <footer
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 16,
          padding: "12px 16px",
          fontSize: 12,
          background: "var(--cc-card)",
          borderTop: "1px solid var(--cc-border)",
        }}
      >
        <Link href="/" style={linkStyle}>
          {BRAND.name}
        </Link>
        <Link href="/privacy" style={linkStyle}>
          Privacy Policy
        </Link>
        <Link href="/terms" style={linkStyle}>
          Terms of Service
        </Link>
        <a href={`mailto:${BRAND.contactEmail}`} style={linkStyle}>
          Contact
        </a>
      </footer>
    </>
  );
}
