import { z } from "zod";

export interface MultimodalUsage {
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  videoSeconds?: number;
  audioSeconds?: number;
}

export interface MultimodalRates {
  inputPer1kTokens: number;
  outputPer1kTokens: number;
  perImage: number;
  perVideoSecond: number;
  perAudioSecond: number;
}

export const DEFAULT_MULTIMODAL_RATES: MultimodalRates = {
  inputPer1kTokens: 0.003,
  outputPer1kTokens: 0.015,
  perImage: 0.004,
  perVideoSecond: 0.002,
  perAudioSecond: 0.0001,
};

export interface MultimodalCostResult {
  totalUsd: number;
  byModality: Record<string, number>;
}

export interface MultimodalBudgetAssertion {
  ok: boolean;
  totalUsd: number;
}

const ratesSchema = z.object({
  inputPer1kTokens: z.number(),
  outputPer1kTokens: z.number(),
  perImage: z.number(),
  perVideoSecond: z.number(),
  perAudioSecond: z.number(),
});

function safeNonNegative(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}

function safeRates(rates?: MultimodalRates): MultimodalRates {
  const parsed = ratesSchema.safeParse(rates);
  const source = parsed.success ? parsed.data : DEFAULT_MULTIMODAL_RATES;
  return {
    inputPer1kTokens: safeNonNegative(source.inputPer1kTokens),
    outputPer1kTokens: safeNonNegative(source.outputPer1kTokens),
    perImage: safeNonNegative(source.perImage),
    perVideoSecond: safeNonNegative(source.perVideoSecond),
    perAudioSecond: safeNonNegative(source.perAudioSecond),
  };
}

function safeUsage(usage: MultimodalUsage): Required<MultimodalUsage> {
  const source: Record<string, unknown> =
    usage && typeof usage === "object" && !Array.isArray(usage)
      ? (usage as Record<string, unknown>)
      : {};
  return {
    inputTokens: safeNonNegative(source.inputTokens),
    outputTokens: safeNonNegative(source.outputTokens),
    images: safeNonNegative(source.images),
    videoSeconds: safeNonNegative(source.videoSeconds),
    audioSeconds: safeNonNegative(source.audioSeconds),
  };
}

export function estimateMultimodalCost(
  usage: MultimodalUsage,
  rates?: MultimodalRates,
): MultimodalCostResult {
  const u = safeUsage(usage);
  const r = safeRates(rates);

  const textCost =
    (u.inputTokens / 1000) * r.inputPer1kTokens + (u.outputTokens / 1000) * r.outputPer1kTokens;
  const imagesCost = u.images * r.perImage;
  const videoCost = u.videoSeconds * r.perVideoSecond;
  const audioCost = u.audioSeconds * r.perAudioSecond;

  const byModality: Record<string, number> = {
    text: safeNonNegative(textCost),
    images: safeNonNegative(imagesCost),
    video: safeNonNegative(videoCost),
    audio: safeNonNegative(audioCost),
  };

  const totalUsd = safeNonNegative(
    byModality.text + byModality.images + byModality.video + byModality.audio,
  );

  return { totalUsd, byModality };
}

function safeCap(capUsd: number): number {
  return safeNonNegative(capUsd);
}

export function assertWithinMultimodalBudget(
  usage: MultimodalUsage,
  capUsd: number,
  rates?: MultimodalRates,
): MultimodalBudgetAssertion {
  const { totalUsd } = estimateMultimodalCost(usage, rates);
  const cap = safeCap(capUsd);
  const ok = totalUsd < cap;
  return { ok, totalUsd };
}

export function assertWithinMultimodalBudgetOrThrow(
  usage: MultimodalUsage,
  capUsd: number,
  rates?: MultimodalRates,
): MultimodalBudgetAssertion {
  const result = assertWithinMultimodalBudget(usage, capUsd, rates);
  if (!result.ok) {
    throw new Error(
      `Multimodal cost budget exceeded: $${result.totalUsd} >= cap $${safeCap(capUsd)}`,
    );
  }
  return result;
}
