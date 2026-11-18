import Link from "next/link";
import { BRAND } from "@/lib/brand";

/**
 * The public site's header and footer, shared by the homepage and the pages it
 * links to (/mcp). `onHome` keeps the section links as in-page anchors there
 * and points them back at the homepage everywhere else.
 */
export function SiteHeader({ onHome = false, current }: { onHome?: boolean; current?: "mcp" }) {
  const anchor = (id: string) => (onHome ? `#${id}` : `/#${id}`);
  return (
    <header className="lp-header">
      <div className="lp-shell lp-header-row">
        <div className="lp-brand">
          <span className="lp-brand-mark" aria-hidden>
            {BRAND.short}
          </span>
          <span className="lp-brand-name">
            {onHome ? BRAND.name : <Link href="/" className="lp-brand-home">{BRAND.name}</Link>}
            <a href={BRAND.umbrellaUrl} className="lp-brand-by lp-hide-sm">
              by {BRAND.umbrella}
            </a>
          </span>
        </div>
        <nav aria-label="Primary" className="lp-nav">
          <a href={anchor("product")} className="lp-nav-link lp-hide-sm">
            Product
          </a>
          <a href={anchor("how")} className="lp-nav-link lp-hide-sm">
            How it works
          </a>
          <Link href="/explore" className="lp-nav-link lp-hide-sm">
            Marketplace
          </Link>
          <Link
            href="/mcp"
            className="lp-nav-link lp-nav-mcp"
            aria-current={current === "mcp" ? "page" : undefined}
            data-testid="nav-mcp"
          >
            MCP
            <span className="lp-nav-new">New</span>
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
  );
}

export function SiteFooter() {
  return (
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
          <Link href="/mcp" className="lp-nav-link">
            MCP
          </Link>
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
  );
}
