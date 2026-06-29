import { TOOL_REGISTRY, getTool } from "@/lib/ai/tools/registry";

describe("TOOL_REGISTRY", () => {
  const expectedNames = [
    "search_creators",
    "authenticity_check",
    "roi_forecast",
    "brand_fit",
    "send_invite",
    "request_payout",
  ];

  it("contains all six starter tools", () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...expectedNames].sort());
    expect(Object.keys(TOOL_REGISTRY)).toHaveLength(6);
  });

  it("keys every entry by its own def.name with no mismatches", () => {
    for (const [key, def] of Object.entries(TOOL_REGISTRY)) {
      expect(key).toBe(def.name);
    }
  });

  it("every tool has a non-empty description, category, and permission", () => {
    for (const def of Object.values(TOOL_REGISTRY)) {
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.category.length).toBeGreaterThan(0);
      expect(def.permission.length).toBeGreaterThan(0);
      expect(typeof def.audit).toBe("boolean");
    }
  });

  describe("input schemas", () => {
    it("search_creators parses a valid sample and applies the limit default", () => {
      const parsed = TOOL_REGISTRY.search_creators.input.parse({
        query: "fitness micro creators",
        platform: "TIKTOK",
        minFollowers: 1000,
      });
      expect(parsed).toMatchObject({
        query: "fitness micro creators",
        platform: "TIKTOK",
        minFollowers: 1000,
        limit: 25,
      });
    });

    it("search_creators rejects a missing query", () => {
      expect(
        TOOL_REGISTRY.search_creators.input.safeParse({ platform: "TIKTOK" }).success,
      ).toBe(false);
    });

    it("search_creators rejects limit > 100", () => {
      expect(
        TOOL_REGISTRY.search_creators.input.safeParse({ query: "x", limit: 101 })
          .success,
      ).toBe(false);
    });

    it("search_creators rejects an unknown platform", () => {
      expect(
        TOOL_REGISTRY.search_creators.input.safeParse({
          query: "x",
          platform: "SNAPCHAT",
        }).success,
      ).toBe(false);
    });

    it("authenticity_check parses a valid sample and rejects a missing creatorId", () => {
      expect(
        TOOL_REGISTRY.authenticity_check.input.safeParse({ creatorId: "c_1" }).success,
      ).toBe(true);
      expect(TOOL_REGISTRY.authenticity_check.input.safeParse({}).success).toBe(false);
    });

    it("roi_forecast parses a valid sample and rejects a non-positive budget", () => {
      expect(
        TOOL_REGISTRY.roi_forecast.input.safeParse({
          creatorId: "c_1",
          campaignBudget: 5000,
        }).success,
      ).toBe(true);
      expect(
        TOOL_REGISTRY.roi_forecast.input.safeParse({
          creatorId: "c_1",
          campaignBudget: 0,
        }).success,
      ).toBe(false);
    });

    it("brand_fit parses a valid sample and rejects an empty keyword list", () => {
      expect(
        TOOL_REGISTRY.brand_fit.input.safeParse({
          creatorId: "c_1",
          brandKeywords: ["sustainable", "outdoor"],
        }).success,
      ).toBe(true);
      expect(
        TOOL_REGISTRY.brand_fit.input.safeParse({
          creatorId: "c_1",
          brandKeywords: [],
        }).success,
      ).toBe(false);
    });

    it("send_invite parses a valid sample and rejects a missing campaignId", () => {
      expect(
        TOOL_REGISTRY.send_invite.input.safeParse({
          creatorId: "c_1",
          campaignId: "camp_1",
        }).success,
      ).toBe(true);
      expect(
        TOOL_REGISTRY.send_invite.input.safeParse({ creatorId: "c_1" }).success,
      ).toBe(false);
    });

    it("request_payout parses a valid sample and rejects amount <= 0", () => {
      expect(
        TOOL_REGISTRY.request_payout.input.safeParse({
          activationId: "act_1",
          amount: 250,
        }).success,
      ).toBe(true);
      expect(
        TOOL_REGISTRY.request_payout.input.safeParse({
          activationId: "act_1",
          amount: 0,
        }).success,
      ).toBe(false);
      expect(
        TOOL_REGISTRY.request_payout.input.safeParse({
          activationId: "act_1",
          amount: -10,
        }).success,
      ).toBe(false);
    });
  });

  describe("approval gating", () => {
    it("read tools have requiresApproval=false", () => {
      for (const name of ["search_creators", "authenticity_check", "roi_forecast", "brand_fit"]) {
        expect(TOOL_REGISTRY[name].requiresApproval).toBe(false);
      }
    });

    it("write tools have requiresApproval=true", () => {
      expect(TOOL_REGISTRY.send_invite.requiresApproval).toBe(true);
      expect(TOOL_REGISTRY.request_payout.requiresApproval).toBe(true);
    });
  });

  describe("getTool", () => {
    it("returns the matching definition for a known name", () => {
      const tool = getTool("search_creators");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("search_creators");
    });

    it("returns undefined for an unknown name", () => {
      expect(getTool("does_not_exist")).toBeUndefined();
    });
  });
});
