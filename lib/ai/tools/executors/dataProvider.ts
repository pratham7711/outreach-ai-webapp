import type { ExecutionContext } from "@/lib/ai/tools/execute";
import type { AuthenticityInput } from "@/lib/ai/scoring/authenticity";
import type { RoiInput } from "@/lib/ai/scoring/roi";
import type { BrandFitInput } from "@/lib/ai/scoring/brandFit";

export interface AuthenticityRef {
  creatorId: string;
}

export interface RoiRef {
  creatorId: string;
  campaignBudget: number;
}

export interface BrandFitRef {
  creatorId: string;
  brandKeywords: string[];
}

export interface ScoringDataProvider {
  getAuthenticityInput(
    ref: AuthenticityRef,
    ctx: ExecutionContext,
  ): Promise<AuthenticityInput>;
  getRoiInput(ref: RoiRef, ctx: ExecutionContext): Promise<RoiInput>;
  getBrandFitInput(
    ref: BrandFitRef,
    ctx: ExecutionContext,
  ): Promise<BrandFitInput>;
}
