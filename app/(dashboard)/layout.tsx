import NewSidebar from "@/components/NewSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { TenantProvider } from "@/components/providers/TenantProvider";
import { SidebarProvider } from "@/components/providers/SidebarProvider";
import { DashboardContent } from "@/components/layout/DashboardContent";
import { ConfirmProvider } from "@/components/ds";
import { Toaster } from "sonner";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";
import { resolveDashboardPolicy } from "@/lib/dashboardPolicy";
import { customBrandingValue } from "@/lib/brandingDefaults";
import type { OrgUiConfig } from "@/lib/orgConfig";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { VerifyEmailBanner } from "@/components/layout/VerifyEmailBanner";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
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
     keep being told to confirm it until the token expired. One indexed lookup
     by primary key is the cheaper half of that trade. */
  const userId = (session?.user as any)?.id as string | undefined;
  const account = userId
    ? await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } })
    : null;
  const needsEmailVerification = Boolean(account && !account.emailVerified);

  const uiConfig = (entitlements?.uiConfig as OrgUiConfig | null) ?? null;
  const policy = resolveDashboardPolicy({ entitlements, uiConfig });

  const primaryColorOverride = orgId
    ? customBrandingValue("primaryColor", policy.primaryColor)
    : null;

  return (
    <TenantProvider>
      <SidebarProvider>
       <ConfirmProvider>
        <div
          className="flex h-screen overflow-hidden"
          style={{
            background: "var(--cc-bg)",
            ...(primaryColorOverride ? { "--cc-primary": primaryColorOverride } as React.CSSProperties : {}),
          }}
        >
          {/* Skip to content link for accessibility */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-white focus:rounded-lg focus:shadow-lg focus:text-sm focus:font-semibold"
            style={{ color: "var(--cc-primary)" }}
          >
            Skip to main content
          </a>

          <Toaster richColors position="bottom-right" />
          <NewSidebar
            allowedNavHrefs={orgId ? policy.allowedNavHrefs : null}
            brandName={orgId ? policy.brandName : null}
            brandLogoUrl={orgId ? policy.logoUrl : null}
            user={user}
          />
          <DashboardContent>
            <TopBar user={user} />
            {needsEmailVerification && account?.email && (
              <VerifyEmailBanner email={account.email} />
            )}
            <main id="main-content" className="flex-1 overflow-y-auto" role="main">
              <div className="page-enter">
                {children}
              </div>
            </main>
          </DashboardContent>
        </div>
       </ConfirmProvider>
      </SidebarProvider>
    </TenantProvider>
  );
}
