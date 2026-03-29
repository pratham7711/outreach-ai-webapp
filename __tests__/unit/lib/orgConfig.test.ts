import type { OrgUiConfig } from "@/lib/orgConfig";

// Mock db before importing getOrgUiConfig
const mockFindUnique = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    organization: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
  },
}));

import { getOrgUiConfig } from "@/lib/orgConfig";

describe("getOrgUiConfig", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
  });

  it("returns parsed config when org exists with uiConfig", async () => {
    const uiConfig: OrgUiConfig = {
      features: { soundTracker: true, creatorPortal: false },
      nav: ["campaigns", "creators"],
      branding: { primaryColor: "#6366f1", brandName: "Test Org" },
      limits: { maxCampaigns: 50 },
      platforms: { tiktok: true, instagram: true },
      dashboard: ["kpi_grid", "views_over_time"],
    };

    mockFindUnique.mockResolvedValue({ uiConfig, brandName: "Test Org" });

    const result = await getOrgUiConfig("org-123");

    expect(result).toEqual(uiConfig);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "org-123" },
      select: { uiConfig: true, brandName: true },
    });
  });

  it("returns null for missing org", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await getOrgUiConfig("nonexistent-org");

    expect(result).toBeNull();
  });

  it("returns null when org exists but uiConfig is null", async () => {
    mockFindUnique.mockResolvedValue({ uiConfig: null, brandName: "Test Org" });

    const result = await getOrgUiConfig("org-123");

    expect(result).toBeNull();
  });

  it("OrgUiConfig type validates expected shape", () => {
    // TypeScript compile-time check — if this compiles, the type is correct
    const config: OrgUiConfig = {
      features: { soundTracker: true, creatorPortal: false, aiBriefings: false, reports: true, csvExport: true },
      nav: ["campaigns", "creators", "payouts", "analytics", "trackers", "lists"],
      branding: { primaryColor: "#6366f1", brandName: "Outreach AI" },
      limits: { maxCampaigns: 50, maxCreators: 500, maxUsers: 10 },
      platforms: { tiktok: true, instagram: true, youtube: true },
      dashboard: ["kpi_grid", "views_over_time", "platform_breakdown", "top_posts", "financial_summary", "creator_performance"],
    };

    expect(config.features?.soundTracker).toBe(true);
    expect(config.nav).toHaveLength(6);
    expect(config.branding?.brandName).toBe("Outreach AI");
    expect(config.limits?.maxCampaigns).toBe(50);
    expect(config.platforms?.tiktok).toBe(true);
    expect(config.dashboard).toHaveLength(6);
  });
});
