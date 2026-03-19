import { PLANS, hasFeature, getPlanLimits, type PlanName } from "@/lib/plans";

describe("PLANS config", () => {
  it("defines all 4 plans", () => {
    expect(Object.keys(PLANS)).toEqual(["free", "starter", "pro", "enterprise"]);
  });

  it("free plan has correct limits", () => {
    expect(PLANS.free.max_campaigns).toBe(3);
    expect(PLANS.free.max_creators).toBe(50);
    expect(PLANS.free.max_users).toBe(2);
  });

  it("starter plan has correct limits", () => {
    expect(PLANS.starter.max_campaigns).toBe(20);
    expect(PLANS.starter.max_creators).toBe(500);
    expect(PLANS.starter.max_users).toBe(5);
  });

  it("pro plan has unlimited campaigns and creators", () => {
    expect(PLANS.pro.max_campaigns).toBe(Infinity);
    expect(PLANS.pro.max_creators).toBe(Infinity);
  });

  it("enterprise plan has unlimited everything", () => {
    expect(PLANS.enterprise.max_campaigns).toBe(Infinity);
    expect(PLANS.enterprise.max_creators).toBe(Infinity);
    expect(PLANS.enterprise.max_users).toBe(Infinity);
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
