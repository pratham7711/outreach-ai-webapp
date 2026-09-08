/**
 * @jest-environment node
 *
 * proxy.ts runs the edge half of the auth config and cannot reach the database,
 * so a deactivated user's cookie still passes the middleware. The Node-side jwt
 * callback is what turns that into a null session, and only the dashboard layout
 * sees it. Without a guard there, the whole shell rendered for a removed
 * teammate while every API call 401ed.
 */
import { redirect } from "next/navigation";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const mockAuth = jest.fn();
jest.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

jest.mock("@/lib/db", () => ({
  db: {
    organization: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}));

/* The layout pulls the whole dashboard chrome in. None of it is under test and
   the node environment cannot parse the TSX, so it is stubbed out. */
jest.mock("@/components/NewSidebar", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/layout/TopBar", () => ({ TopBar: () => null }));
jest.mock("@/components/providers/TenantProvider", () => ({ TenantProvider: () => null }));
jest.mock("@/components/providers/SidebarProvider", () => ({ SidebarProvider: () => null }));
jest.mock("@/components/layout/DashboardContent", () => ({ DashboardContent: () => null }));
jest.mock("@/components/layout/VerifyEmailBanner", () => ({ VerifyEmailBanner: () => null }));
jest.mock("@/components/ds", () => ({ ConfirmProvider: () => null }));
jest.mock("sonner", () => ({ Toaster: () => null }));
jest.mock("@/lib/billing/subscription", () => ({ isPlatformAdmin: jest.fn().mockResolvedValue(false) }));
jest.mock("@/lib/dashboardPolicy", () => ({ resolveDashboardPolicy: jest.fn().mockReturnValue({}) }));

jest.mock("@/lib/entitlements", () => ({
  getOrgEntitlements: jest.fn().mockResolvedValue(null),
}));

import DashboardLayout from "@/app/(dashboard)/layout";

beforeEach(() => jest.clearAllMocks());

describe("dashboard layout — a revoked session cannot keep the shell", () => {
  it("sends a null session to /login instead of rendering", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(DashboardLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("sends a session with no user to /login as well", async () => {
    mockAuth.mockResolvedValue({});
    await expect(DashboardLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
