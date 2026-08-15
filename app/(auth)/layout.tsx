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
      <footer
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 2,
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
