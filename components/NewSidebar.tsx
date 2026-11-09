"use client";
import Link from "next/link";
import { NavLink } from "@/components/layout/NavLink";
import { BRAND } from "@/lib/brand";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import CampaignRailNav from "@/components/CampaignRailNav";
import { campaignIdFromPathname, shellForPathname } from "@/lib/campaignSections";
import {
  LayoutDashboard, Megaphone, Calendar, Users, Users2, LineChart,
  List, CreditCard, Shield, UserSearch,
  ChevronDown, ChevronLeft, Settings, LogOut, Menu, X, Key, BarChart2, Activity, Music, Tags,
  Globe, MessageSquareWarning, Building2, Bell, Plug, Wallet, Inbox, UserCheck,
} from "lucide-react";
import { PAYOUTS_ENABLED } from "@/lib/payouts/switch";
import { mediaUrl } from "@/lib/postMedia";
import { useSidebar } from "@/components/providers/SidebarProvider";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { ThemeRadioGroup } from "@/components/ThemeChoices";

/*
  The money side of the product is parked, not deleted: we are not offering
  payments yet, so Payouts, Requests, Recipients and Financials are unlinked
  while their routes and tables stay put. Inbox and Fan Pages are parked the
  same way. Everything reachable here is campaign delivery and reporting.

  Parked the same way in October 2026, on prod usage: Activations (the
  campaign's Creators tab is where that work happens), Deadlines (no
  deliverables exist), Clients (none created since March), Discovery (refused by
  plan), Connections (stored a flag, connected nothing) and Billing. Their URLs
  redirect (next.config.ts). Activity Log moved to the Settings hub, for admins.
*/
/* Payouts, payout requests and recipients, listed only while payouts are
   switched on (lib/payouts/switch.ts). Off, their URLs redirect and their API
   routes answer 404; their rules stay in DASHBOARD_NAV_RULES either way, so
   switching back on needs nothing here. */
const PAYOUTS_SECTION = {
  label: "Payments",
  items: [
    { href: "/payouts", icon: Wallet, label: "Payouts" },
    { href: "/requests", icon: Inbox, label: "Requests" },
    { href: "/recipients", icon: UserCheck, label: "Recipients" },
  ],
};

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
      { href: "/calendar", icon: Calendar, label: "Calendar" },
      { href: "/trackers", icon: LineChart, label: "Trackers" },
      { href: "/analytics", icon: BarChart2, label: "Analytics" },
    ],
  },
  {
    label: "Creators & Pitching",
    items: [
      { href: "/creators", icon: Users, label: "Creator Roster" },
      { href: "/lists", icon: List, label: "Lists" },
      { href: "/creator-finder", icon: UserSearch, label: "Creator Finder" },
    ],
  },
  ...(PAYOUTS_ENABLED ? [PAYOUTS_SECTION] : []),
  {
    /* Not "Settings": the group's first row is already called that, and the
       heading read "SETTINGS > Settings". */
    label: "Workspace",
    items: [
      { href: "/settings", icon: Settings, label: "Settings" },
      { href: "/settings/general", icon: Tags, label: "General" },
      /* Profile, Notifications and Integrations were cards on the Settings hub
         with no row here, so the rail -- the index people actually scan --
         listed six of the nine settings pages. */
      { href: "/settings/profile", icon: Building2, label: "Profile" },
      { href: "/settings/team", icon: Users2, label: "Team" },
      { href: "/settings/trackers", icon: LineChart, label: "Tracker settings" },
      { href: "/settings/api-keys", icon: Key, label: "API keys" },
      { href: "/settings/notifications", icon: Bell, label: "Notifications" },
      { href: "/settings/integrations", icon: Plug, label: "Integrations" },
      { href: "/settings/ingestion", icon: Activity, label: "Ingestion" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin", icon: Shield, label: "Feature access" },
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
  items: [
    { href: "/platform", icon: Globe, label: "All Organizations" },
    /* "inbox", not "Feedback": the top bar's Feedback button already has that
       name, and this is where reports are read, not sent. */
    { href: "/platform/feedback", icon: MessageSquareWarning, label: "Feedback inbox" },
  ],
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
  /** The tenant's own mark. CreatorCore shows one here; we fall back to the name. */
  brandLogoUrl?: string | null;
  user?: { name: string | null; email: string | null } | null;
};

/**
 * The collapsed rail's name for each icon. Labels stay in the DOM while the rail
 * is narrow (they are the links' accessible names), so the tooltip reads the
 * label it is standing in for rather than carrying a second copy of the text.
 * Painted in a portal: the rail clips its overflow, and a tooltip is the one
 * thing that has to sit outside it.
 */
function RailTooltip({ tip }: { tip: { text: string; x: number; y: number } | null }) {
  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div className="cc-rail-tooltip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      {tip.text}
    </div>,
    document.body,
  );
}

const TIP_TARGET = "[data-tip], .cc-sidebar-nav .cc-nav-item, .cc-rail-user";

function tipText(el: HTMLElement): string | null {
  return (
    el.dataset.tip ??
    el.querySelector(".cc-nav-label, .cc-sidebar-username")?.textContent ??
    el.getAttribute("aria-label")
  );
}

function sidebarInitials(name?: string | null, email?: string | null): string {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}


export default function NewSidebar({ allowedNavHrefs, isPlatformOperator, brandName, brandLogoUrl, user }: SidebarProps = {}) {
  const [logoBroken, setLogoBroken] = useState(false);
  const userName = user?.name || user?.email || "Account";
  const userInitial = sidebarInitials(user?.name, user?.email);
  const pathname = usePathname();
  const { mobileOpen, ready, setMobileOpen, collapsed, toggleCollapsed } = useSidebar();
  const [showUserMenu, setShowUserMenu] = useState(false);
  /* Collapsed, the rail is too narrow to hold the account menu, so it opens
     beside the rail instead -- in a portal, since the rail clips. */
  const [menuFloating, setMenuFloating] = useState(false);
  /* A tip belongs to the rail state and page it was shown on; a collapse or a
     navigation retires it without an effect, because it no longer matches. */
  const tipCtx = `${collapsed}|${pathname}`;
  const [tip, setTip] = useState<{ text: string; x: number; y: number; ctx: string } | null>(null);
  const tipFor = useRef<{ el: HTMLElement; ctx: string } | null>(null);
  const isDesktop = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

  const showTip = useCallback(
    (target: EventTarget | null) => {
      const el = target instanceof Element ? (target.closest(TIP_TARGET) as HTMLElement | null) : null;
      if (!el || (tipFor.current?.el === el && tipFor.current.ctx === tipCtx)) return;
      tipFor.current = { el, ctx: tipCtx };
      const always = el.dataset.tip !== undefined;
      const text = tipText(el);
      if (!text || (!always && !collapsed) || !isDesktop()) {
        setTip(null);
        return;
      }
      const r = el.getBoundingClientRect();
      /* Read at hover time, not render time, so server and client agree. */
      const kbd = el.dataset.tipKbd !== undefined ? (/Mac|iPhone|iPad/.test(navigator.platform) ? "  \u2318\\" : "  Ctrl+\\") : "";
      setTip({ text: text.trim() + kbd, x: r.right + 10, y: r.top + r.height / 2, ctx: tipCtx });
    },
    [collapsed, tipCtx],
  );
  const hideTip = useCallback(() => {
    tipFor.current = null;
    setTip(null);
  }, []);

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

  /* Inside a campaign the rail belongs to that campaign, not to the workspace.
     Its sections replace the global nav entirely, as they do in the reference
     app, and "All campaigns" at the top is the way back out. */
  const campaignId = campaignIdFromPathname(pathname);

  const showLogo = Boolean(brandLogoUrl) && !logoBroken;
  const tipHandlers = {
    onPointerOver: (e: React.PointerEvent) => showTip(e.target),
    onPointerLeave: hideTip,
    onFocus: (e: React.FocusEvent) => showTip(e.target),
    onBlur: hideTip,
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className={`cc-rail-hamburger fixed top-1.5 left-2 z-50 size-11 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-card shadow-sm lg:hidden ${
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

      {/* Collapse / expand. On the rail's edge, outside the aside because the
          aside clips its overflow and this straddles the border. Desktop only:
          below 1024 the rail is a drawer with its own close button. */}
      <button
        type="button"
        className="cc-rail-toggle"
        data-ready={ready}
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        aria-controls="cc-rail"
        data-tip={`${collapsed ? "Expand" : "Collapse"} sidebar`}
        data-tip-kbd=""
        aria-keyshortcuts="Meta+Backslash Control+Backslash"
        {...tipHandlers}
      >
        <ChevronLeft size={14} strokeWidth={2.25} aria-hidden="true" />
      </button>

      {/* Sidebar */}
      <aside
        id="cc-rail"
        {...tipHandlers}
        className={`cc-sidebar-rail fixed top-0 bottom-0 left-0 z-40 flex flex-col overflow-hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        data-parity="shell.rail"
        /* The shell's own identity, published for CSS. The rail is the only
           node that knows a campaign is open, and the page header two levels
           away needs it -- their campaign screens set a 20px title against the
           dashboard's 24px. Routing the same pathname test through a second
           component would give two places to keep in step. */
        data-shell={shellForPathname(pathname)}
        data-ready={ready}
        role="navigation"
        aria-label="Main sidebar"
      >
        {/* Header: Logo + Org */}
        <div className="cc-sidebar-head h-14 flex items-center shrink-0 justify-between">
              {/*
                The tenant's own uploaded logo when there is one, otherwise its
                name. Nothing of ours sits beside it: the product mark and the
                initials chip both read as somebody's logo, and neither was.
              */}
              <div className="flex min-w-0 items-center gap-2.5">
                {showLogo ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={mediaUrl(brandLogoUrl) ?? undefined}
                    alt={brandName ? `${brandName} logo` : "Organisation logo"}
                    onError={() => setLogoBroken(true)}
                    className="cc-rail-logo-img"
                  />
                ) : (
                  <span
                    className="cc-rail-brand"
                    title={brandName ?? BRAND.name}
                  >
                    {brandName ?? BRAND.name}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {/* Mobile close */}
                <button
                  className="flex cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground lg:hidden"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation menu"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
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
              <CampaignRailNav campaignId={campaignId} />
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
              <div className="cc-nav-group-label">{section.label}</div>

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
                    <NavLink
                      href={href}
                      className={`cc-nav-item sidebar-link ${active ? "active btn-press" : ""}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon size={16} className="cc-nav-icon" aria-hidden="true" />
                      <span className="cc-nav-label">{label}</span>
                      {badge && !active && (
                        <span className="cc-nav-badge">
                          {badge}
                        </span>
                      )}
                    </NavLink>
                  );

                  return <div key={href}>{navLink}</div>;
                }
              )}
            </div>
            );
          })
          )}
        </nav>

        {/* Footer - User Profile */}
        <div className="cc-sidebar-footer px-2 py-2">
          <div className="cc-rail-feedback">
            <FeedbackButton surface="dashboard" />
          </div>
          {/* User menu dropdown */}
          {showUserMenu && (() => {
            const menu = (
            <div className="cc-rail-usermenu cc-scale-in" data-floating={menuFloating || undefined}>
              <Link
                href="/settings"
                className="cc-nav-item"
                onClick={() => setShowUserMenu(false)}
              >
                <Settings size={15} aria-hidden="true" />
                <span>Settings</span>
              </Link>
              <div className="cc-rail-usermenu-divider" />
              <ThemeRadioGroup />
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
            );
            return menuFloating ? createPortal(menu, document.body) : menu;
          })()}

          <button
            onClick={() => {
              setMenuFloating(collapsed && isDesktop());
              setShowUserMenu(!showUserMenu);
            }}
            className="cc-rail-user"
            data-open={showUserMenu}
            aria-expanded={showUserMenu}
            aria-label="User menu"
            title={userName}
          >
            <div className="flex items-center gap-2.5">
              <div className="cc-sidebar-avatar" aria-hidden="true">
                {userInitial}
              </div>
              <span className="cc-sidebar-username" title={userName}>
                {userName}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ChevronDown
                size={14}
                aria-hidden="true"
                className="cc-rail-user-chevron"
              />
            </div>
          </button>
        </div>
      </aside>
      <RailTooltip tip={tip?.ctx === tipCtx ? tip : null} />
    </>
  );
}
