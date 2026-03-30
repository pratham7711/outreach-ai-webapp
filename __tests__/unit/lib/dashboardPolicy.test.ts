import { resolveDashboardPolicy, getDashboardNavHref } from "@/lib/dashboardPolicy";
import type { OrgEntitlements } from "@/lib/entitlements";

function makeEntitlements(overrides: Partial<OrgEntitlements> = {}): OrgEntitlements {
  return {
    orgId: "org-1",
    planName: "pro",
    features: ["campaigns", "creator_database", "basic_reports", "media_kits", "audit_log"],
    featureMap: {
      campaigns: true,
      creator_database: true,
      basic_reports: true,
      media_kits: true,
      audit_log: true,
    },
    limits: {
      maxCampaigns: 20,
      maxCreators: 500,
      maxUsers: 5,
    },
    branding: {
      brandName: "Acme Labels",
      logoUrl: null,
      faviconUrl: null,
      primaryColor: "#123456",
      secondaryColor: "#0f172a",
      accentColor: "#f59e0b",
      fontFamily: "Inter",
    },
    uiConfig: null,
    ...overrides,
  };
}

describe("resolveDashboardPolicy()", () => {
  it("returns baseline nav and branding when uiConfig.nav is absent", () => {
    const policy = resolveDashboardPolicy({
      entitlements: makeEntitlements(),
      uiConfig: null,
    });

    expect(policy.brandName).toBe("Acme Labels");
    expect(policy.primaryColor).toBe("#123456");
    expect(policy.navAllowKeys).toBeNull();
    expect(policy.allowedNavHrefs).toEqual(expect.arrayContaining([
      "/campaigns",
      "/reports",
      "/media-kits",
      "/settings",
      "/admin",
    ]));
    expect(policy.allowedNavHrefSet.has("/audit-log")).toBe(true);
  });

  it("hides audit log when the feature is disabled", () => {
    const policy = resolveDashboardPolicy({
      entitlements: makeEntitlements({
        featureMap: {
          campaigns: true,
          creator_database: true,
          basic_reports: true,
          media_kits: true,
          audit_log: false,
        },
      }),
      uiConfig: null,
    });

    expect(policy.allowedNavHrefs).not.toContain("/audit-log");
    expect(policy.allowedNavHrefSet.has("/audit-log")).toBe(false);
  });

  it("keeps hard-required settings and admin routes visible", () => {
    const policy = resolveDashboardPolicy({
      entitlements: makeEntitlements({
        featureMap: {
          campaigns: false,
          creator_database: false,
          basic_reports: false,
          media_kits: false,
          audit_log: false,
        },
      }),
      uiConfig: {
        nav: [],
      },
    });

    expect(policy.allowedNavHrefs).toEqual(expect.arrayContaining([
      "/settings",
      "/connections",
      "/settings/team",
      "/settings/api-keys",
      "/settings/billing",
      "/admin",
      "/plans",
    ]));
    expect(policy.allowedNavHrefs).not.toContain("/audit-log");
  });

  it("applies uiConfig.nav after entitlement filtering", () => {
    const policy = resolveDashboardPolicy({
      entitlements: makeEntitlements({
        featureMap: {
          campaigns: true,
          creator_database: true,
          basic_reports: true,
          media_kits: true,
          audit_log: false,
        },
      }),
      uiConfig: {
        nav: ["campaigns", "audit-log"],
        features: {
          reports: true,
        },
        branding: {
          brandName: "Policy Brand",
          primaryColor: "#abcdef",
        },
      },
    });

    expect(policy.brandName).toBe("Policy Brand");
    expect(policy.primaryColor).toBe("#abcdef");
    expect(policy.navAllowKeys).toEqual(["campaigns", "audit-log"]);
    expect(policy.featureMap.reports).toBe(true);
    expect(policy.allowedNavHrefs).toEqual(expect.arrayContaining([
      "/campaigns",
      "/settings",
      "/admin",
    ]));
    expect(policy.allowedNavHrefs).not.toContain("/creators");
    expect(policy.allowedNavHrefs).not.toContain("/lists");
    expect(policy.allowedNavHrefs).not.toContain("/audit-log");
    expect(policy.allowedNavHrefs).not.toContain("/media-kits");
  });
});

describe("getDashboardNavHref()", () => {
  it("maps nav keys to route hrefs", () => {
    expect(getDashboardNavHref("audit-log")).toBe("/audit-log");
    expect(getDashboardNavHref("campaigns")).toBe("/campaigns");
    expect(getDashboardNavHref("unknown")).toBeUndefined();
  });
});
