import { z } from "zod";
import type { ExecutionContext } from "@/lib/ai/tools/execute";
import {
  authenticity_check,
  roi_forecast,
  brand_fit,
} from "@/lib/ai/tools/registry";
import { scoreAuthenticity } from "@/lib/ai/scoring/authenticity";
import { forecastRoi } from "@/lib/ai/scoring/roi";
import { scoreBrandFit } from "@/lib/ai/scoring/brandFit";
import type { ScoringDataProvider } from "@/lib/ai/tools/executors/dataProvider";

type AuthenticityToolInput = z.infer<typeof authenticity_check.input>;
type RoiToolInput = z.infer<typeof roi_forecast.input>;
type BrandFitToolInput = z.infer<typeof brand_fit.input>;

type Executor = (input: unknown, ctx: ExecutionContext) => Promise<unknown>;

export function makeAuthenticityExecutor(
  provider: ScoringDataProvider,
): Executor {
  return async (input: unknown, ctx: ExecutionContext): Promise<unknown> => {
    const parsed = authenticity_check.input.parse(input) as AuthenticityToolInput;
    const scorerInput = await provider.getAuthenticityInput(
      { creatorId: parsed.creatorId },
      ctx,
    );
    return scoreAuthenticity(scorerInput);
  };
}

export function makeRoiExecutor(provider: ScoringDataProvider): Executor {
  return async (input: unknown, ctx: ExecutionContext): Promise<unknown> => {
    const parsed = roi_forecast.input.parse(input) as RoiToolInput;
    const scorerInput = await provider.getRoiInput(
      {
        creatorId: parsed.creatorId,
        campaignBudget: parsed.campaignBudget,
      },
      ctx,
    );
    return forecastRoi(scorerInput);
  };
}

export function makeBrandFitExecutor(provider: ScoringDataProvider): Executor {
  return async (input: unknown, ctx: ExecutionContext): Promise<unknown> => {
    const parsed = brand_fit.input.parse(input) as BrandFitToolInput;
    const scorerInput = await provider.getBrandFitInput(
      {
        creatorId: parsed.creatorId,
        brandKeywords: parsed.brandKeywords,
      },
      ctx,
    );
    return scoreBrandFit(scorerInput);
  };
}

export function makeScoringExecutors(
  provider: ScoringDataProvider,
): Record<string, Executor> {
  return {
    [authenticity_check.name]: makeAuthenticityExecutor(provider),
    [roi_forecast.name]: makeRoiExecutor(provider),
    [brand_fit.name]: makeBrandFitExecutor(provider),
  };
}
