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
    <header className="mb-header">
      <div className="mb-shell mb-header-row">
        <div className="mb-brand">
          <span className="mb-mark" aria-hidden>
            {BRAND.short}
          </span>
          <span className="mb-brand-name">
            {onHome ? BRAND.name : <Link href="/" className="mb-brand-home">{BRAND.name}</Link>}
            <a href={BRAND.umbrellaUrl} className="mb-brand-by mb-hide-md">
              by {BRAND.umbrella}
            </a>
          </span>
        </div>
        <nav aria-label="Primary" className="mb-nav">
          <a href={anchor("how")} className="mb-nav-link mb-hide-md">
            How it works
          </a>
          <a href={anchor("product")} className="mb-nav-link mb-hide-md">
            Product
          </a>
          <Link href="/explore" className="mb-nav-link mb-hide-md">
            Marketplace
          </Link>
          <Link
            href="/mcp"
            className="mb-nav-link"
            aria-current={current === "mcp" ? "page" : undefined}
            data-testid="nav-mcp"
          >
            MCP
            <span className="mb-nav-new">New</span>
          </Link>
          <Link href="/about" className="mb-nav-link mb-hide-md">
            About
          </Link>
          <Link href="/login" className="mb-nav-link mb-nav-signin">
            Sign in
          </Link>
          <Link href="/signup" className="mb-btn mb-btn-light mb-btn-sm">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mb-footer">
      <div className="mb-shell">
        <div className="mb-footer-top">
          <div>
            <p className="mb-brand">
              <span className="mb-mark" aria-hidden>
                {BRAND.short}
              </span>
              <span className="mb-brand-name">{BRAND.name}</span>
            </p>
            <p className="mb-footer-note">
              A <a href={BRAND.umbrellaUrl}>{BRAND.umbrella}</a> product. {BRAND.jurisdiction}.
            </p>
          </div>
          <nav aria-label="Footer" className="mb-footer-nav">
            <Link href="/explore">Marketplace</Link>
            <Link href="/mcp">MCP</Link>
            <Link href="/about">About</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/data-deletion">Data deletion</Link>
            <a href={`mailto:${BRAND.contactEmail}`}>Contact</a>
            <Link href="/login">Sign in</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
