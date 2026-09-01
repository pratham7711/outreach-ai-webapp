import { PLANS, hasFeature, getPlanLimits, type PlanName } from "@/lib/plans";

describe("PLANS config", () => {
  it("defines all 4 plans", () => {
    expect(Object.keys(PLANS)).toEqual(["free", "starter", "pro", "enterprise"]);
  });

  it("leaves campaigns and creators uncapped on every tier", () => {
    /* Trackers are the only thing a plan limits. The lower tiers used to carry
       3/50 and 20/500, and nothing ever enforced either number -- it was shown
       on the billing screen and the next campaign was created anyway. */
    for (const plan of Object.keys(PLANS) as PlanName[]) {
      expect(PLANS[plan].max_campaigns).toBe(Infinity);
      expect(PLANS[plan].max_creators).toBe(Infinity);
      // Seats joined them on 2026-09-01. A seat is a row; a tracker is a
      // recurring platform fetch, and that is the difference that decides this.
      expect(PLANS[plan].max_users).toBe(Infinity);
    }
  });

  /* The invariant, not just today's numbers: trackers are the ONLY thing a
     plan limits. If a second finite limit ever appears here, that is a product
     decision and this test should be the thing that makes someone say it out
     loud. */
  it("makes trackers the only finite limit on any tier", () => {
    for (const plan of Object.keys(PLANS) as PlanName[]) {
      const limits = PLANS[plan];
      const finite = (["max_campaigns", "max_creators", "max_users", "max_trackers"] as const)
        .filter((k) => Number.isFinite(limits[k]));
      expect(finite).not.toContain("max_users");
      expect(finite.every((k) => k === "max_trackers")).toBe(true);
    }
  });

  it("keeps trackers real and rising by tier", () => {
    expect(PLANS.free.max_trackers).toBe(3);
    expect(PLANS.starter.max_trackers).toBe(25);
    expect(PLANS.pro.max_trackers).toBe(200);
    expect(PLANS.enterprise.max_trackers).toBe(Infinity);
  });

  it("every plan includes 'campaigns' feature", () => {
    for (const plan of Object.keys(PLANS) as PlanName[]) {
      expect(PLANS[plan].features).toContain("campaigns");
    }
  });

  it("pro includes all starter features", () => {
    const starterFeatures = PLANS.starter.features as readonly string[];
    const proFeatures = PLANS.pro.features as readonly string[];
    for (const f of starterFeatures) {
      expect(proFeatures).toContain(f);
    }
  });

  it("enterprise includes all pro features", () => {
    const proFeatures = PLANS.pro.features as readonly string[];
    const enterpriseFeatures = PLANS.enterprise.features as readonly string[];
    for (const f of proFeatures) {
      expect(enterpriseFeatures).toContain(f);
    }
  });

  it("enterprise has exclusive features not in pro", () => {
    const proFeatures = PLANS.pro.features as readonly string[];
    const enterpriseFeatures = PLANS.enterprise.features as readonly string[];
    const exclusiveToEnterprise = enterpriseFeatures.filter((f) => !proFeatures.includes(f));
    expect(exclusiveToEnterprise).toContain("custom_domain");
    expect(exclusiveToEnterprise).toContain("sso");
    expect(exclusiveToEnterprise).toContain("ai_creator_discovery");
  });
});

describe("hasFeature()", () => {
  it("returns true for a feature in the plan", () => {
    expect(hasFeature("free", "campaigns")).toBe(true);
    expect(hasFeature("starter", "media_kits")).toBe(true);
    expect(hasFeature("pro", "audio_analytics")).toBe(true);
    expect(hasFeature("enterprise", "sso")).toBe(true);
  });

  it("returns false for a feature not in the plan", () => {
    expect(hasFeature("free", "media_kits")).toBe(false);
    expect(hasFeature("free", "audio_analytics")).toBe(false);
    expect(hasFeature("starter", "payments")).toBe(false);
    expect(hasFeature("pro", "sso")).toBe(false);
  });

  it("returns false for unknown plan", () => {
    expect(hasFeature("unknown_plan", "campaigns")).toBe(false);
    expect(hasFeature("", "campaigns")).toBe(false);
  });

  it("returns false for empty feature string", () => {
    expect(hasFeature("pro", "")).toBe(false);
  });

  it("is case-sensitive for feature names", () => {
    expect(hasFeature("pro", "Campaigns")).toBe(false);
    expect(hasFeature("pro", "CAMPAIGNS")).toBe(false);
    expect(hasFeature("pro", "campaigns")).toBe(true);
  });

  it("returns false for feature that doesn't exist in any plan", () => {
    expect(hasFeature("enterprise", "nonexistent_feature")).toBe(false);
  });
});

describe("getPlanLimits()", () => {
  it("returns correct config for each plan", () => {
    expect(getPlanLimits("free")).toEqual(PLANS.free);
    expect(getPlanLimits("starter")).toEqual(PLANS.starter);
    expect(getPlanLimits("pro")).toEqual(PLANS.pro);
    expect(getPlanLimits("enterprise")).toEqual(PLANS.enterprise);
  });

  it("falls back to free plan for unknown plan names", () => {
    expect(getPlanLimits("unknown")).toEqual(PLANS.free);
    expect(getPlanLimits("")).toEqual(PLANS.free);
  });

  it("returns an object with max_campaigns, max_creators, max_users, features", () => {
    const limits = getPlanLimits("pro");
    expect(limits).toHaveProperty("max_campaigns");
    expect(limits).toHaveProperty("max_creators");
    expect(limits).toHaveProperty("max_users");
    expect(limits).toHaveProperty("features");
    expect(Array.isArray(limits.features)).toBe(true);
  });
});
