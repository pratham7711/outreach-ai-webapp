"use client";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import CampaignRailNav from "@/components/CampaignRailNav";
import { campaignIdFromPathname } from "@/lib/campaignSections";
import {
  LayoutDashboard, Megaphone, Play, Calendar, CalendarClock, Users, Users2, LineChart,
  Search, List, Link2, CreditCard, Shield, FileText,
  ChevronDown, Settings, LogOut, Menu, X, ChevronsLeft, Key, BarChart2, Activity, Music, Tags,
  Globe
} from "lucide-react";
import { mediaUrl } from "@/lib/postMedia";
import { useSidebar } from "@/components/providers/SidebarProvider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ThemeToggle from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/layout/NotificationBell";

/*
  The money side of the product is parked, not deleted: we are not offering
  payments yet, so Payouts, Requests, Recipients and Financials are unlinked
  while their routes and tables stay put. Inbox and Fan Pages are parked the
  same way. Everything reachable here is campaign delivery and reporting.
*/
/**
 * Exported so a test can assert every href here has a rule in
 * DASHBOARD_NAV_RULES. The sidebar renders these filtered by that allowlist, so
 * an item added here without a rule is invisible to every org -- which has now
 * happened three times (/deadlines, /analytics, and /settings/general, the last
 * of which hid the taxonomy manager from everyone).
 */
export const NAV_SECTIONS = [
  {
    label: "Campaigns & Reporting",
    items: [
      { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/songs", icon: Music, label: "Songs" },
      { href: "/campaigns", icon: Megaphone, label: "Campaigns" },
      { href: "/activations", icon: Play, label: "Activations" },
      { href: "/calendar", icon: Calendar, label: "Calendar" },
      { href: "/deadlines", icon: CalendarClock, label: "Deadlines" },
      { href: "/clients", icon: Users, label: "Clients" },
      { href: "/trackers", icon: LineChart, label: "Trackers" },
      { href: "/analytics", icon: BarChart2, label: "Analytics" },
      { href: "/audit-log", icon: FileText, label: "Activity Log" },
    ],
  },
  {
    label: "Creators & Pitching",
    items: [
      { href: "/discovery", icon: Search, label: "Discovery" },
      { href: "/creators", icon: Users, label: "Creators" },
      { href: "/lists", icon: List, label: "Lists" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings", icon: Settings, label: "Settings" },
      { href: "/settings/general", icon: Tags, label: "General" },
      { href: "/connections", icon: Link2, label: "Connections" },
      { href: "/settings/team", icon: Users2, label: "Team" },
      { href: "/settings/trackers", icon: LineChart, label: "Tracker settings" },
      { href: "/settings/api-keys", icon: Key, label: "API Keys" },
      { href: "/settings/billing", icon: CreditCard, label: "Billing" },
      { href: "/settings/ingestion", icon: Activity, label: "Ingestion" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin", icon: Shield, label: "Feature Access" },
      { href: "/plans", icon: CreditCard, label: "Plans" },
    ],
  },
];

/**
 * Deliberately NOT in NAV_SECTIONS, and deliberately not subject to
 * allowedNavHrefs.
 *
 * Those are per-org entitlements -- what this tenant has paid for. This is a
 * different axis entirely: whether the person signed in operates the platform,
 * decided by the PLATFORM_ADMIN_EMAILS allowlist. Putting it through the nav
 * rules would let an org's entitlement config decide who can read every other
 * org, which is exactly the confusion /platform exists on the far side of.
 *
 * Hiding the link is cosmetic, not the control: the page itself calls
 * isPlatformAdmin() and 404s. This only keeps it out of tenants' sight.
 */
const PLATFORM_SECTION = {
  label: "Platform",
  items: [{ href: "/platform", icon: Globe, label: "All Organizations" }],
};

/**
 * Nav hrefs that are a prefix of another nav item's href. Those match exactly, so
 * /settings/billing lights Billing alone rather than Settings and Billing together.
 */
const CHILD_NAV_PARENTS = new Set(
  [...NAV_SECTIONS, PLATFORM_SECTION]
    .flatMap((s) => s.items.map((i) => i.href))
    .filter((href, _i, all) => all.some((other) => other !== href && other.startsWith(href + "/")))
);

type SidebarProps = {
  allowedNavHrefs?: string[] | null;
  /** Whether to show the operator-only Platform section. See PLATFORM_SECTION. */
  isPlatformOperator?: boolean;
  brandName?: string | null;
  /** The tenant's own mark. CreatorCore shows one here; we fall back to initials. */
  brandLogoUrl?: string | null;
  user?: { name: string | null; email: string | null } | null;
};

function sidebarInitials(name?: string | null, email?: string | null): string {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function UserMenuTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: React.ReactElement;
}) {
  if (!enabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export default function NewSidebar({ allowedNavHrefs, isPlatformOperator, brandName, brandLogoUrl, user }: SidebarProps = {}) {
  const [logoBroken, setLogoBroken] = useState(false);
  const userName = user?.name || user?.email || "Account";
  const userInitial = sidebarInitials(user?.name, user?.email);
  const pathname = usePathname();
  const { collapsed, mobileOpen, ready, toggle, setMobileOpen } = useSidebar();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const allowedHrefSet = useMemo(
    () => new Set(allowedNavHrefs ?? []),
    [allowedNavHrefs]
  );

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  // Close on escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && mobileOpen) {
      setMobileOpen(false);
    }
  }, [mobileOpen, setMobileOpen]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  // Close user menu when collapsing
  useEffect(() => {
    if (collapsed) setShowUserMenu(false);
  }, [collapsed]);

  const isRail = collapsed && !mobileOpen;

  /* Inside a campaign the rail belongs to that campaign, not to the workspace.
     Its sections replace the global nav entirely, as they do in the reference
     app, and "All campaigns" at the top is the way back out. */
  const campaignId = campaignIdFromPathname(pathname);

  const logoMark = (
    <div className="cc-rail-logo">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="white" strokeWidth="2.5" />
        <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="1.5" fill="white" />
      </svg>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className={`fixed top-1.5 left-2 z-50 size-11 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-card shadow-sm lg:hidden ${
          mobileOpen ? "hidden" : "flex"
        }`}
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
      >
        <Menu size={20} aria-hidden="true" className="text-foreground" />
      </button>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="cc-scrim lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`cc-sidebar-rail fixed top-0 bottom-0 left-0 z-40 flex flex-col overflow-hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        data-parity="shell.rail"
        /* The shell's own identity, published for CSS. The rail is the only
           node that knows a campaign is open, and the page header two levels
           away needs it -- their campaign screens set a 20px title against the
           dashboard's 24px. Routing the same pathname test through a second
           component would give two places to keep in step. */
        data-shell={campaignId ? "campaign" : pathname.startsWith("/settings") ? "settings" : "dashboard"}
        data-collapsed={mobileOpen ? false : collapsed}
        data-ready={ready}
        role="navigation"
        aria-label="Main sidebar"
      >
        {/* Header: Logo + Org + Collapse Toggle */}
        <div
          className={`cc-sidebar-head h-14 flex items-center shrink-0 ${isRail ? "justify-center" : "justify-between"}`}
        >
          {isRail ? (
            <Tooltip>
              <TooltipTrigger
                onClick={toggle}
                aria-label="Expand sidebar"
                className="btn-press flex cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0"
              >
                {logoMark}
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2.5">
                {logoMark}
                <span
                  className="cc-rail-brand truncate"
                  title={brandName ?? BRAND.name}
                >
                  {brandName ?? BRAND.name}
                </span>
              </div>

              <div className="cc-rail-head-end flex items-center gap-1.5">
                {/*
                  CreatorCore's rail carries the tenant's uploaded logo here --
                  a 90x30 image beside its own wordmark. Ours drew two letters
                  because nothing passed the org's logoUrl down, though
                  entitlements had been reading it all along. The initials stay
                  as the fallback: every org's logoUrl is still null, and an
                  image that 404s must not leave a blank gap where the brand was.
                */}
                {brandLogoUrl && !logoBroken ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={mediaUrl(brandLogoUrl) ?? undefined}
                    alt={brandName ? `${brandName} logo` : "Organisation logo"}
                    onError={() => setLogoBroken(true)}
                    className="cc-rail-logo-img"
                  />
                ) : brandName ? (
                  <div aria-hidden="true" className="cc-rail-initials">
                    {sidebarInitials(brandName)}
                  </div>
                ) : null}

                {/* Mobile close */}
                <button
                  className="flex cursor-pointer items-center rounded-md border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground lg:hidden"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation menu"
                >
                  <X size={18} aria-hidden="true" />
                </button>

                {/* Desktop collapse toggle */}
                <button
                  className="btn-press hidden cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-primary lg:flex"
                  onClick={toggle}
                  aria-label="Collapse sidebar"
                >
                  <ChevronsLeft size={16} aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Nav Sections */}
        <nav
          className="cc-sidebar-nav flex-1 overflow-y-auto px-2 py-2"
          data-parity="shell.rail.items"
          aria-label={campaignId ? "Campaign navigation" : "Main navigation"}
        >
          {campaignId ? (
            /* The boundary is for useSearchParams inside: without one, any
               dashboard route that Next decides to prerender fails the build
               rather than this rail falling back for a frame. */
            <Suspense fallback={null}>
              <CampaignRailNav campaignId={campaignId} isRail={isRail} />
            </Suspense>
          ) : (
          [...NAV_SECTIONS, ...(isPlatformOperator ? [PLATFORM_SECTION] : [])].map((section, gi) => {
            /* The platform section skips the entitlement filter on purpose --
               it answers to the email allowlist, not to what an org bought. */
            const exemptFromNavRules = section.label === PLATFORM_SECTION.label;
            const filteredItems = allowedNavHrefs == null || exemptFromNavRules
              ? section.items
              : section.items.filter((item) => allowedHrefSet.has(item.href));
            if (filteredItems.length === 0) return null;
            return (
            <div
              key={section.label}
              className="mb-1"
              data-parity={gi === 0 ? "shell.rail.group-first" : undefined}
            >
              {/* Section label — hidden when collapsed */}
              {!isRail && (
                <div className="cc-nav-group-label">{section.label}</div>
              )}
              {/* Thin separator when collapsed */}
              {isRail && (
                <div className="cc-rail-divider" />
              )}

              {filteredItems.map(
                ({
                  href,
                  icon: Icon,
                  label,
                  badge,
                }: {
                  href: string;
                  icon: React.ElementType;
                  label: string;
                  badge?: string;
                }) => {
                  // Prefix matching lit both "Settings" and "Billing" on
                  // /settings/billing, because /settings is itself a nav item and a
                  // parent of the rest of that section.
                  const active = CHILD_NAV_PARENTS.has(href)
                    ? pathname === href
                    : pathname === href || pathname.startsWith(href + "/");
                  const navLink = (
                    <Link
                      href={href}
                      className={`cc-nav-item sidebar-link ${active ? "active btn-press" : ""}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon
                        size={isRail ? 19 : 17}
                        className="cc-nav-icon"
                        aria-hidden="true"
                      />
                      {!isRail && (
                        <span className="cc-nav-label">{label}</span>
                      )}
                      {!isRail && badge && !active && (
                        <span className="cc-nav-badge">
                          {badge}
                        </span>
                      )}
                    </Link>
                  );

                  // The rail clips its own overflow, so a CSS tooltip can never
                  // escape it — the portalled Tooltip is what makes icon-only
                  // navigation readable.
                  if (!isRail) return <div key={href}>{navLink}</div>;

                  return (
                    <Tooltip key={href}>
                      <TooltipTrigger render={navLink} />
                      <TooltipContent side="right" sideOffset={8}>
                        {label}
                      </TooltipContent>
                    </Tooltip>
                  );
                }
              )}
            </div>
            );
          })
          )}
        </nav>

        {/* Footer - User Profile */}
        <div className="cc-sidebar-footer px-2 py-2">
          {/* The theme toggle and the bell live in two places and are painted in
              one: creatorcore hides the top bar above 1024px to put the page
              header where the reference puts it, and a theme that silently took
              away the only control for changing themes would be a trap. CSS
              cannot move a node to a different parent, so the node exists twice
              and `--cc-rail-utility-display` decides which copy is seen. */}
          <div className="cc-rail-utility" aria-hidden={false}>
            <ThemeToggle />
            <NotificationBell />
          </div>
          {/* User menu dropdown */}
          {showUserMenu && !isRail && (
            <div className="cc-rail-usermenu cc-scale-in">
              <Link
                href="/settings"
                className="cc-nav-item"
                onClick={() => setShowUserMenu(false)}
              >
                <Settings size={15} aria-hidden="true" />
                <span>Settings</span>
              </Link>
              <div className="cc-rail-usermenu-divider" />
              <button
                className="cc-nav-item cc-rail-usermenu-signout"
                aria-label="Sign out of your account"
                onClick={() => { setShowUserMenu(false); signOut({ callbackUrl: "/login" }); }}
              >
                <LogOut size={15} aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </div>
          )}

          <UserMenuTooltip label={userName} enabled={isRail}>
          <button
            onClick={() => {
              if (isRail) {
                toggle();
                return;
              }
              setShowUserMenu(!showUserMenu);
            }}
            className="cc-rail-user"
            data-open={showUserMenu}
            aria-expanded={showUserMenu}
            aria-label={isRail ? `${userName} — expand sidebar` : "User menu"}
          >
            <div className="flex items-center gap-2.5">
              <div className="cc-sidebar-avatar" aria-hidden="true">
                {userInitial}
              </div>
              {!isRail && (
                <span className="cc-sidebar-username" title={userName}>
                  {userName}
                </span>
              )}
            </div>
            {!isRail && (
              <div className="flex items-center gap-2">
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className="cc-rail-user-chevron"
                />
              </div>
            )}
          </button>
          </UserMenuTooltip>
        </div>
      </aside>
    </>
  );
}
