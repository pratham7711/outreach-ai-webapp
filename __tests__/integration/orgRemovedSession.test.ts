/**
 * @jest-environment node
 *
 * A session outlives the organization it points at.
 *
 * Sessions are JWTs carrying orgId, so nothing revokes one when the org is
 * deleted. The dashboard then renders full signed-in chrome around panels that
 * load nothing and /api/tenant/config answers 404 on every navigation -- and
 * there is no way out from the UI, because the middleware bounces a logged-in
 * visitor away from /login. Measured on prod after the demo cleanup removed an
 * org whose user still had a live session.
 *
 * The check is free: the layout already reads entitlements for branding and
 * nav, so a null there is the evidence, no extra query needed.
 */
jest.mock("next/navigation", () => ({
  redirect: jest.fn((path: string) => {
    // Next's redirect throws to unwind rendering; mimic that so a test can tell
    // the difference between "redirected" and "carried on and rendered".
    const error = new Error(`NEXT_REDIRECT:${path}`);
    throw error;
  }),
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
/* The layout's client components pull in next-auth/react and sonner, which ship
   ESM jest does not transform. Nothing here inspects the rendered tree -- the
   assertion is whether the layout redirects -- so they are stubbed out. */
jest.mock("@/components/NewSidebar", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/layout/TopBar", () => ({ TopBar: () => null }));
jest.mock("@/components/providers/TenantProvider", () => ({ TenantProvider: () => null }));
jest.mock("@/components/providers/SidebarProvider", () => ({ SidebarProvider: () => null }));
jest.mock("@/components/layout/DashboardContent", () => ({ DashboardContent: () => null }));
jest.mock("@/components/ds", () => ({ ConfirmProvider: () => null }));
jest.mock("sonner", () => ({ Toaster: () => null }));
jest.mock("@/lib/entitlements", () => ({ getOrgEntitlements: jest.fn() }));

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";
import DashboardLayout from "@/app/(dashboard)/layout";

const mockAuth = auth as unknown as jest.Mock;
const mockEntitlements = getOrgEntitlements as unknown as jest.Mock;
const mockRedirect = redirect as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

async function renderLayout() {
  // The layout is an async server component; calling it is the whole render.
  return DashboardLayout({ children: null });
}

it("signs out a session whose organization has been removed", async () => {
  mockAuth.mockResolvedValue({ user: { email: "someone@example.com", orgId: "org-gone" } });
  mockEntitlements.mockResolvedValue(null);

  await expect(renderLayout()).rejects.toThrow(
    "NEXT_REDIRECT:/api/auth/session-invalid",
  );
  expect(mockRedirect).toHaveBeenCalledWith("/api/auth/session-invalid");
});

it("sends a signed-out visitor to /login rather than rendering the shell", async () => {
  /* Every route under app/(dashboard) is private -- the public ones (/explore,
     /share, /c, /portal, /privacy, /terms, /verify-email) live outside this
     group -- so a null session here is a revoked or expired one, not a public
     page. proxy.ts cannot catch it: the edge auth config only decodes the
     cookie, while the jwt callback that reads isActive runs Node-side. Measured
     2026-09-08 before this guard: a deactivated teammate got 401 from /api/org
     and 200 from /dashboard. /login is outside this layout, so no loop. */
  mockAuth.mockResolvedValue(null);

  await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT:/login");

  expect(mockRedirect).toHaveBeenCalledWith("/login");
  expect(mockEntitlements).not.toHaveBeenCalled();
});

it("renders normally when the organization is still there", async () => {
  mockAuth.mockResolvedValue({ user: { email: "someone@example.com", orgId: "org-1" } });
  mockEntitlements.mockResolvedValue({
    orgId: "org-1",
    planName: "starter",
    features: {},
    limits: { maxCampaigns: 10, maxCreators: 100, maxUsers: 5 },
    branding: { brandName: "LKay Media", logoUrl: null, primaryColor: null },
    uiConfig: null,
  });

  await renderLayout();

  expect(mockRedirect).not.toHaveBeenCalled();
});
