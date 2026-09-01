const mockFindUnique = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    organization: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
  },
}));

import { getOrgEntitlements } from "@/lib/entitlements";
import { PLANS } from "@/lib/plans";

/* An org row as Prisma returns it from getOrgEntitlements's include. Only the
   plan fields matter here; branding is filled so the mapper does not crash. */
function orgRow(over: {
  plan?: string;
  planConfig?: { planName?: string; maxTrackers?: number | null; features?: unknown } | null;
}) {
  return {
    id: "org-1",
    name: "Org",
    plan: over.plan ?? "free",
    planConfig:
      over.planConfig === null
        ? null
        : over.planConfig === undefined
          ? null
          : { planName: "free", maxTrackers: null, features: {}, ...over.planConfig },
    brandName: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: "#000",
    secondaryColor: "#111",
    accentColor: "#222",
    fontFamily: "Inter",
    uiConfig: null,
  };
}

describe("getOrgEntitlements", () => {
  beforeEach(() => mockFindUnique.mockReset());

  it("returns null for an org that does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getOrgEntitlements("nope")).toBeNull();
  });

  /* The whole point of the resolution order: the settings route writes
     planConfig.planName and never touches Organization.plan, so an upgrade that
     only lands in planConfig must still raise the tracker limit. Reading limits
     off org.plan is how an org ends up labelled "pro" and held to free's zero. */
  it("takes limits from planConfig.planName, not the stale Organization.plan", async () => {
    mockFindUnique.mockResolvedValue(orgRow({ plan: "free", planConfig: { planName: "pro" } }));

    const ent = await getOrgEntitlements("org-1");

    expect(ent?.planName).toBe("pro");
    expect(ent?.limits.maxTrackers).toBe(PLANS.pro.max_trackers);
  });

  it("falls back to Organization.plan when there is no planConfig row", async () => {
    mockFindUnique.mockResolvedValue(orgRow({ plan: "pro", planConfig: null }));

    const ent = await getOrgEntitlements("org-1");

    expect(ent?.planName).toBe("pro");
    expect(ent?.limits.maxTrackers).toBe(PLANS.pro.max_trackers);
  });

  /* An unreadable plan name must land on the smallest tier. Defaulting the
     other way would hand every typo an enterprise account. */
  it("treats an unrecognised plan name as free", async () => {
    mockFindUnique.mockResolvedValue(orgRow({ plan: "legacy-gold", planConfig: { planName: "legacy-gold" } }));

    const ent = await getOrgEntitlements("org-1");

    expect(ent?.planName).toBe("legacy-gold");
    expect(ent?.limits.maxTrackers).toBe(PLANS.free.max_trackers);
    expect(ent?.limits.maxTrackers).toBe(0);
  });

  /* A per-org override beats the tier in both directions, and 0 is a value a
     falsy check would drop. */
  it("honours a per-org maxTrackers override, including zero", async () => {
    mockFindUnique.mockResolvedValue(orgRow({ planConfig: { planName: "pro", maxTrackers: 7 } }));
    expect((await getOrgEntitlements("org-1"))?.limits.maxTrackers).toBe(7);

    mockFindUnique.mockResolvedValue(orgRow({ planConfig: { planName: "enterprise", maxTrackers: 0 } }));
    expect((await getOrgEntitlements("org-1"))?.limits.maxTrackers).toBe(0);
  });

  it("leaves campaigns, creators and seats uncapped on every tier", async () => {
    for (const plan of Object.keys(PLANS)) {
      mockFindUnique.mockResolvedValue(orgRow({ planConfig: { planName: plan } }));
      const ent = await getOrgEntitlements("org-1");
      expect(ent?.limits.maxCampaigns).toBe(Infinity);
      expect(ent?.limits.maxCreators).toBe(Infinity);
      expect(ent?.limits.maxUsers).toBe(Infinity);
    }
  });
});
