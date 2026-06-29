import {
  executeTool,
  type ExecutionContext,
  type ExecuteDeps,
} from "@/lib/ai/tools/execute";
import { makeScoringExecutors } from "@/lib/ai/tools/executors/scoring";
import type {
  ScoringDataProvider,
  AuthenticityRef,
  RoiRef,
  BrandFitRef,
} from "@/lib/ai/tools/executors/dataProvider";
import type { AuthenticityInput } from "@/lib/ai/scoring/authenticity";
import type { RoiInput } from "@/lib/ai/scoring/roi";
import type { BrandFitInput } from "@/lib/ai/scoring/brandFit";
import type { ScoreFactor } from "@/lib/ai/scoring/roi";

const AUTHENTICITY_FIXTURE: AuthenticityInput = {
  followers: 100_000,
  following: 800,
  avgLikes: 6_000,
  avgComments: 240,
  avgViews: 40_000,
  postCount: 120,
  followerGrowthSeries: [1_200, 1_300, 1_250, 1_400],
  audienceCountryShares: { US: 0.6, IN: 0.3, GB: 0.1 },
};

const ROI_FIXTURE: RoiInput = {
  followers: 100_000,
  engagementRate: 0.06,
  avgViews: 40_000,
  pastCampaignConversions: [300, 420, 380],
  benchmarkConversionRate: 0.012,
  productPrice: 49,
  estimatedCost: 5_000,
  category: "saas",
};

const BRAND_FIT_FIXTURE: BrandFitInput = {
  creatorCategories: ["fitness", "wellness"],
  creatorAudience: {
    countryShares: { US: 0.7, CA: 0.2, GB: 0.1 },
    ageShares: { "18-24": 0.5, "25-34": 0.4 },
    interestShares: { fitness: 0.6, nutrition: 0.3 },
  },
  creatorBrandSafetyFlags: [],
  brand: {
    categories: ["fitness", "supplements"],
    targetCountries: ["US"],
    targetAgeBands: ["18-24"],
    targetInterests: ["fitness"],
    brandSafetyLevel: "standard",
  },
};

interface RecordedCall {
  ref: AuthenticityRef | RoiRef | BrandFitRef;
  ctx: ExecutionContext;
}

class StubProvider implements ScoringDataProvider {
  public authenticityCalls: RecordedCall[] = [];
  public roiCalls: RecordedCall[] = [];
  public brandFitCalls: RecordedCall[] = [];

  async getAuthenticityInput(
    ref: AuthenticityRef,
    ctx: ExecutionContext,
  ): Promise<AuthenticityInput> {
    this.authenticityCalls.push({ ref, ctx });
    return AUTHENTICITY_FIXTURE;
  }

  async getRoiInput(ref: RoiRef, ctx: ExecutionContext): Promise<RoiInput> {
    this.roiCalls.push({ ref, ctx });
    return ROI_FIXTURE;
  }

  async getBrandFitInput(
    ref: BrandFitRef,
    ctx: ExecutionContext,
  ): Promise<BrandFitInput> {
    this.brandFitCalls.push({ ref, ctx });
    return BRAND_FIT_FIXTURE;
  }
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    orgId: "org_1",
    userId: "user_1",
    permissions: ["creators:read", "campaigns:read"],
    ...overrides,
  };
}

function makeDeps(provider: ScoringDataProvider): ExecuteDeps {
  return { executors: makeScoringExecutors(provider) };
}

function isScoreShape(data: unknown): data is {
  score: number;
  confidence: string;
  factors: ScoreFactor[];
} {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as { score: unknown }).score === "number" &&
    Array.isArray((data as { factors: unknown }).factors)
  );
}

describe("scoring executors through executeTool", () => {
  it("authenticity_check returns ok with a valid ScoreResult", async () => {
    const provider = new StubProvider();
    const result = await executeTool(
      "authenticity_check",
      { creatorId: "creator_1" },
      makeCtx(),
      makeDeps(provider),
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(isScoreShape(result.data)).toBe(true);
      if (isScoreShape(result.data)) {
        expect(result.data.score).toBeGreaterThanOrEqual(0);
        expect(result.data.score).toBeLessThanOrEqual(100);
        expect(result.data.factors.length).toBeGreaterThan(0);
        expect(["low", "medium", "high"]).toContain(result.data.confidence);
      }
    }
  });

  it("roi_forecast returns ok with a forecast carrying a projection", async () => {
    const provider = new StubProvider();
    const result = await executeTool(
      "roi_forecast",
      { creatorId: "creator_1", campaignBudget: 5_000 },
      makeCtx(),
      makeDeps(provider),
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(isScoreShape(result.data)).toBe(true);
      const data = result.data as {
        score: number;
        projection: {
          expectedReach: number;
          expectedConversions: number;
          expectedRevenue: number;
          expectedRoiMultiple: number;
        };
      };
      expect(data.projection).toBeDefined();
      expect(typeof data.projection.expectedReach).toBe("number");
      expect(typeof data.projection.expectedRoiMultiple).toBe("number");
      expect(data.score).toBeGreaterThanOrEqual(0);
      expect(data.score).toBeLessThanOrEqual(100);
    }
  });

  it("brand_fit returns ok with a valid score", async () => {
    const provider = new StubProvider();
    const result = await executeTool(
      "brand_fit",
      { creatorId: "creator_1", brandKeywords: ["fitness", "supplements"] },
      makeCtx(),
      makeDeps(provider),
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(isScoreShape(result.data)).toBe(true);
      if (isScoreShape(result.data)) {
        expect(result.data.score).toBeGreaterThanOrEqual(0);
        expect(result.data.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("resolves provider data scoped by ctx.orgId, never a value from input", async () => {
    const provider = new StubProvider();
    const ctx = makeCtx({ orgId: "org_tenant_A" });
    await executeTool(
      "authenticity_check",
      { creatorId: "creator_99" },
      ctx,
      makeDeps(provider),
    );
    expect(provider.authenticityCalls).toHaveLength(1);
    expect(provider.authenticityCalls[0].ctx.orgId).toBe("org_tenant_A");
    expect(provider.authenticityCalls[0].ref.creatorId).toBe("creator_99");
  });

  it("passes ctx (with orgId) to the ROI and brand-fit provider lookups too", async () => {
    const provider = new StubProvider();
    const ctx = makeCtx({ orgId: "org_tenant_B" });
    await executeTool(
      "roi_forecast",
      { creatorId: "creator_7", campaignBudget: 9_000 },
      ctx,
      makeDeps(provider),
    );
    await executeTool(
      "brand_fit",
      { creatorId: "creator_7", brandKeywords: ["beauty"] },
      ctx,
      makeDeps(provider),
    );
    expect(provider.roiCalls[0].ctx.orgId).toBe("org_tenant_B");
    expect(provider.brandFitCalls[0].ctx.orgId).toBe("org_tenant_B");
  });

  it("does not let input carry an orgId into the provider scope", async () => {
    const provider = new StubProvider();
    const ctx = makeCtx({ orgId: "org_real" });
    await executeTool(
      "authenticity_check",
      { creatorId: "creator_1", orgId: "org_attacker" },
      ctx,
      makeDeps(provider),
    );
    expect(provider.authenticityCalls[0].ctx.orgId).toBe("org_real");
    expect(JSON.stringify(provider.authenticityCalls[0])).not.toContain(
      "org_attacker",
    );
  });

  it("rejects invalid input as invalid_input before the executor runs", async () => {
    const provider = new StubProvider();
    const result = await executeTool(
      "authenticity_check",
      { creatorId: "" },
      makeCtx(),
      makeDeps(provider),
    );
    expect(result.status).toBe("invalid_input");
    expect(provider.authenticityCalls).toHaveLength(0);
  });

  it("rejects a roi_forecast with a non-positive budget before resolving data", async () => {
    const provider = new StubProvider();
    const result = await executeTool(
      "roi_forecast",
      { creatorId: "creator_1", campaignBudget: -10 },
      makeCtx(),
      makeDeps(provider),
    );
    expect(result.status).toBe("invalid_input");
    expect(provider.roiCalls).toHaveLength(0);
  });

  it("is deterministic: same input yields the same data", async () => {
    const provider = new StubProvider();
    const input = { creatorId: "creator_1" };
    const first = await executeTool(
      "authenticity_check",
      input,
      makeCtx(),
      makeDeps(provider),
    );
    const second = await executeTool(
      "authenticity_check",
      input,
      makeCtx(),
      makeDeps(provider),
    );
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status === "ok" && second.status === "ok") {
      expect(second.data).toEqual(first.data);
    }
  });

  it("denies authenticity_check without creators:read and never calls the scorer/provider", async () => {
    const provider = new StubProvider();
    const ctx = makeCtx({ permissions: ["campaigns:read"] });
    const result = await executeTool(
      "authenticity_check",
      { creatorId: "creator_1" },
      ctx,
      makeDeps(provider),
    );
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.reason).toContain("creators:read");
    }
    expect(provider.authenticityCalls).toHaveLength(0);
  });

  it("denies roi_forecast without campaigns:read and never resolves data", async () => {
    const provider = new StubProvider();
    const ctx = makeCtx({ permissions: ["creators:read"] });
    const result = await executeTool(
      "roi_forecast",
      { creatorId: "creator_1", campaignBudget: 5_000 },
      ctx,
      makeDeps(provider),
    );
    expect(result.status).toBe("denied");
    expect(provider.roiCalls).toHaveLength(0);
  });

  it("surfaces a provider failure as executor_threw without crashing the harness", async () => {
    const failing: ScoringDataProvider = {
      getAuthenticityInput: async () => {
        throw new Error("creator not found");
      },
      getRoiInput: async () => ROI_FIXTURE,
      getBrandFitInput: async () => BRAND_FIT_FIXTURE,
    };
    const result = await executeTool(
      "authenticity_check",
      { creatorId: "ghost" },
      makeCtx(),
      { executors: makeScoringExecutors(failing) },
    );
    expect(result.status).toBe("error");
    if (result.status === "error" && result.code === "executor_threw") {
      expect(result.message).toBe("creator not found");
    }
  });
});
