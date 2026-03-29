import NewSidebar from "@/components/NewSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { TenantProvider } from "@/components/providers/TenantProvider";
import { SidebarProvider } from "@/components/providers/SidebarProvider";
import { DashboardContent } from "@/components/layout/DashboardContent";
import { Toaster } from "sonner";
import { auth } from "@/lib/auth";
import { getOrgUiConfig } from "@/lib/orgConfig";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const orgId = (session?.user as any)?.orgId;
  const uiConfig = orgId ? await getOrgUiConfig(orgId) : null;

  const primaryColorOverride = uiConfig?.branding?.primaryColor ?? null;

  return (
    <TenantProvider>
      <SidebarProvider>
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
          <NewSidebar navItems={uiConfig?.nav ?? null} brandName={uiConfig?.branding?.brandName ?? null} />
          <DashboardContent>
            <TopBar />
            <main id="main-content" className="flex-1 overflow-y-auto" role="main">
              <div className="cc-animate-in">
                {children}
              </div>
            </main>
          </DashboardContent>
        </div>
      </SidebarProvider>
    </TenantProvider>
  );
}
