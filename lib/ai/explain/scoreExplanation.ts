import { MODELS } from "@/lib/ai/models";

export type ScoreResultLike = {
  score: number;
  confidence?: string;
  factors: { label: string; impact: number; detail?: string }[];
};

export interface AnalystClient {
  messages: {
    create(args: unknown): Promise<{ content: { type: string; text?: string }[] }>;
  };
}

const DEFAULT_MAX_TOKENS = 1024;

const SYSTEM_TEXT = [
  "You explain an already-computed authenticity score in plain language.",
  "You may ONLY reference the score and the factors provided as evidence below.",
  "Do NOT introduce any number, percentage, statistic, or factor that is not present in the provided evidence.",
  "Do not invent benchmarks, industry averages, or comparisons.",
  "If you are unsure, say so rather than fabricating a figure.",
  "Use only the supplied evidence; cite no fact that is not grounded in it.",
].join(" ");

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatImpact(impact: number): string {
  const safe = safeNumber(impact);
  const direction = safe > 0 ? "positive" : safe < 0 ? "negative" : "neutral";
  return `${direction} (${safe})`;
}

function renderFactor(factor: { label: string; impact: number; detail?: string }): string {
  const lines = [`- ${factor.label}: ${formatImpact(factor.impact)}`];
  if (typeof factor.detail === "string" && factor.detail.length > 0) {
    lines.push(`  detail: ${factor.detail}`);
  }
  return lines.join("\n");
}

export function buildExplanationPrompt(
  subject: string,
  result: ScoreResultLike,
): { system: string; user: string } {
  const score = safeNumber(result.score);
  const factors = Array.isArray(result.factors) ? result.factors : [];

  const evidenceLines = [
    `Subject: ${subject}`,
    `Authenticity score: ${score}`,
  ];

  if (typeof result.confidence === "string" && result.confidence.length > 0) {
    evidenceLines.push(`Confidence: ${result.confidence}`);
  }

  evidenceLines.push("");
  evidenceLines.push("Allowed evidence (factors):");

  if (factors.length === 0) {
    evidenceLines.push("(no contributing factors were recorded)");
  } else {
    for (const factor of factors) {
      evidenceLines.push(renderFactor(factor));
    }
  }

  evidenceLines.push("");
  evidenceLines.push(
    "Write a short explanation of why this score was assigned, using ONLY the evidence above.",
  );

  return {
    system: SYSTEM_TEXT,
    user: evidenceLines.join("\n"),
  };
}

function collectText(content: { type: string; text?: string }[]): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

export async function explainScore(params: {
  subject: string;
  result: ScoreResultLike;
  client: AnalystClient;
  maxTokens?: number;
}): Promise<{ text: string; groundedFactors: string[] }> {
  const { subject, result, client } = params;
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  const prompt = buildExplanationPrompt(subject, result);
  const factors = Array.isArray(result.factors) ? result.factors : [];

  const response = await client.messages.create({
    model: MODELS.analyst,
    max_tokens: maxTokens,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });

  const content = Array.isArray(response.content) ? response.content : [];
  const text = collectText(content);
  const groundedFactors = factors.map((factor) => factor.label);

  return { text, groundedFactors };
}

function extractNumericTokens(text: string): string[] {
  const matches = text.match(/\d+(?:\.\d+)?%?/g);
  return matches ?? [];
}

function normalizeNumber(token: string): string {
  const stripped = token.endsWith("%") ? token.slice(0, -1) : token;
  const value = Number(stripped);
  if (!Number.isFinite(value)) return stripped;
  return String(value);
}

function addTokensFrom(allowed: Set<string>, text: string): void {
  for (const token of extractNumericTokens(text)) {
    allowed.add(normalizeNumber(token));
  }
}

export function validateGrounding(
  text: string,
  result: ScoreResultLike,
): { ok: boolean; unsupportedNumbers: string[] } {
  const allowed = new Set<string>();
  const factors = Array.isArray(result.factors) ? result.factors : [];

  addTokensFrom(allowed, String(safeNumber(result.score)));

  for (const factor of factors) {
    addTokensFrom(allowed, formatImpact(factor.impact));
    if (typeof factor.detail === "string") {
      addTokensFrom(allowed, factor.detail);
    }
  }

  const unsupportedNumbers: string[] = [];
  const seen = new Set<string>();

  for (const token of extractNumericTokens(text)) {
    const normalized = normalizeNumber(token);
    if (allowed.has(normalized)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    unsupportedNumbers.push(token);
  }

  return { ok: unsupportedNumbers.length === 0, unsupportedNumbers };
}
