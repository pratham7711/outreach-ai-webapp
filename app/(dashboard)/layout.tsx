import NewSidebar from "@/components/NewSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { TenantProvider } from "@/components/providers/TenantProvider";
import { SidebarProvider } from "@/components/providers/SidebarProvider";
import { CampaignNavProvider } from "@/components/providers/CampaignNavProvider";
import { DashboardContent } from "@/components/layout/DashboardContent";
import { ShellRoot } from "@/components/layout/ShellRoot";
import { ConfirmProvider } from "@/components/ds";
import { ThemedToaster } from "@/components/layout/ThemedToaster";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { NavigationProgress } from "@/components/layout/NavigationProgress";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { getOrgEntitlements } from "@/lib/entitlements";
import { tenantConfigFor } from "@/lib/tenantConfig";
import { ThemeStyle } from "@/components/sdui/ThemeStyle";
import { navHrefsForRole, resolveDashboardPolicy } from "@/lib/dashboardPolicy";
import { usableIconHref } from "@/lib/brandingDefaults";
import type { OrgUiConfig } from "@/lib/orgConfig";
import { redirect } from "next/navigation";
import { readAccount } from "@/lib/accountCheck";
import { VerifyEmailBanner } from "@/components/layout/VerifyEmailBanner";
import { ActingAsBanner } from "@/components/layout/ActingAsBanner";
import type { ActingAs } from "@/lib/platform/actAs";
import type { Metadata } from "next";

/**
 * The org's own favicon, which was stored and never applied.
 *
 * Organization.faviconUrl is written by Settings → Organization Profile and
 * was only ever echoed back by /api/tenant/config, whose one consumer
 * (TenantProvider) reads colours and fonts off that payload and ignores this
 * field. So a white-labelled workspace kept our tab icon.
 *
 * Scoped to the dashboard segment on purpose: the marketing and auth pages are
 * not a tenant's, so they keep the platform mark. An org with no favicon (or a
 * junk value) returns no `icons` at all, which leaves Next's file conventions —
 * app/icon.png and app/favicon.ico — in charge, rather than substituting an
 * empty href that resolves to the page itself.
 */
export async function generateMetadata(): Promise<Metadata> {
  const session = await auth();
  const orgId = (session?.user as any)?.orgId as string | undefined;
  if (!orgId) return {};

  /* The entitlements read carries faviconUrl already, and is cached for this
     render, so the layout below gets it for nothing. This was its own
     organization read on every page view. */
  const entitlements = await getOrgEntitlements(orgId);
  const icon = usableIconHref(entitlements?.branding.faviconUrl);
  if (!icon) return {};

  return { icons: { icon, shortcut: icon, apple: icon } };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  /* proxy.ts runs the edge half of the auth config, which only checks that the
     cookie decodes -- it cannot reach the database. The jwt callback in
     lib/auth.ts is what notices a deactivated or deleted user, and it only runs
     here, on the Node side. Without this guard a removed teammate kept the whole
     dashboard shell: every API call 401ed, but the chrome and the routes still
     rendered, which reads as "the app is broken" rather than "you were removed".
     Measured 2026-09-08: /api/org answered 401 while /dashboard answered 200.

     Through the sign-out route, not straight to /login: the cookie still
     decodes, so the middleware treats the visitor as logged in and bounces them
     off /login and back here. Measured the same day as ERR_TOO_MANY_REDIRECTS.
     Clearing the cookie is the part that has to happen. */
  if (!session?.user) {
    redirect("/api/auth/session-invalid?reason=account-inactive");
  }

  const orgId = (session?.user as any)?.orgId;
  const user = session?.user
    ? { name: session.user.name ?? null, email: session.user.email ?? null }
    : null;
  const entitlements = orgId ? await getOrgEntitlements(orgId) : null;

  /* A session whose organization has been removed. The JWT still carries the
     orgId, so nothing else notices: the chrome renders, every panel loads
     nothing, and /api/tenant/config answers 404 on every navigation. Signing
     the session out says what happened once instead of failing quietly forever.
     Free to detect -- the entitlements read above is the same one the layout
     already needs. */
  if (session?.user && orgId && !entitlements) {
    redirect("/api/auth/session-invalid");
  }

  /* Read rather than taken from the session. The JWT is minted at sign-in and
     never revisited, so a user who confirms their address mid-session would
     keep being told to confirm it until the token expired. The row comes from
     the same once-a-minute read the jwt callback just made for role and
     isActive (lib/accountCheck), so this costs no query of its own; the
     verify-email route drops it, so a confirmation shows at once. A blip is
     no banner, the same as a missing row. */
  const userId = (session?.user as any)?.id as string | undefined;
  const account = userId ? (await readAccount(userId).catch(() => null))?.row ?? null : null;
  const needsEmailVerification = Boolean(account && !account.emailVerified);

  /* Set by lib/auth.ts when a platform operator has opened somebody else's
     workspace. Everything above this line already describes THAT org -- the
     entitlements, the branding, the nav -- which is the point; the banner is
     what stops that from being invisible. */
  const actingAs = (session.user as { actingAs?: ActingAs }).actingAs ?? null;

  const uiConfig = (entitlements?.uiConfig as OrgUiConfig | null) ?? null;
  const policy = resolveDashboardPolicy({ entitlements, uiConfig });
  const navHrefs = orgId
    ? navHrefsForRole(policy.allowedNavHrefs, (session.user as { role?: string }).role)
    : null;

  return (
    <TenantProvider initial={entitlements ? tenantConfigFor(entitlements) : undefined}>
      <SidebarProvider>
       {/* Wraps the rail and the page both: the campaign page below publishes
           its title and counts, and the rail above reads them. */}
       <CampaignNavProvider>
       <ConfirmProvider>
        <ThemeStyle
          orgId={orgId}
          uiConfig={uiConfig as Record<string, unknown> | null}
        />
        <ShellRoot className="cc-shell-root flex h-screen overflow-hidden">
          {/* Skip to content link for accessibility */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-white focus:rounded-lg focus:shadow-lg focus:text-sm focus:font-semibold"
            style={{ color: "var(--cc-primary)" }}
          >
            Skip to main content
          </a>

          <ThemedToaster richColors position="bottom-right" />
          <FeedbackButton surface="dashboard" />
          <Suspense fallback={null}>
            <NavigationProgress />
          </Suspense>
          <NewSidebar
            allowedNavHrefs={navHrefs}
            /* A separate axis from allowedNavHrefs: that is what this org bought,
               this is whether the person signed in operates the platform. Read
               from the email rather than the JWT because the token is minted at
               sign-in and never revisited, so a change to the allowlist would
               otherwise not take effect until everyone signed out. */
            isPlatformOperator={isPlatformAdmin(session?.user?.email ?? null)}
            brandName={orgId ? policy.brandName : null}
            brandLogoUrl={orgId ? policy.logoUrl : null}
            user={user}
          />
          <DashboardContent>
            <TopBar user={user} navHrefs={navHrefs} />
            {actingAs && (
              <ActingAsBanner orgName={actingAs.orgName} mode={actingAs.mode} />
            )}
            {needsEmailVerification && account?.email && (
              <VerifyEmailBanner email={account.email} />
            )}
            <main id="main-content" className="flex-1 overflow-y-auto" role="main">
              <div className="page-enter">
                {children}
              </div>
            </main>
          </DashboardContent>
        </ShellRoot>
       </ConfirmProvider>
       </CampaignNavProvider>
      </SidebarProvider>
    </TenantProvider>
  );
}
