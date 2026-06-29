import { MODELS } from "@/lib/ai/models";

export type ReportMetric = { label: string; value: number | string };

export type ReportBlock = { kind: string; title: string; metrics: ReportMetric[] };

export type ReportInput = { subject: string; blocks: ReportBlock[] };

export interface AnalystClient {
  messages: {
    create(args: unknown): Promise<{ content: { type: string; text?: string }[] }>;
  };
}

const DEFAULT_MAX_TOKENS = 1024;

const BLOCK_MARKER = "===BLOCK===";

const SYSTEM_TEXT = [
  "You narrate already-computed campaign and creator report blocks in plain language.",
  "You may ONLY reference the metric values supplied as evidence below.",
  "Do NOT introduce or invent any number, percentage, statistic, benchmark, average, ranking, or comparison that is not present in the provided evidence.",
  "Treat block titles and metric labels as descriptive headings, NOT as data you may cite.",
  "If a figure is not in the evidence, do not state it; prefer omission over fabrication.",
  `Write one narrative per block. Separate each block's narrative with a line containing exactly ${BLOCK_MARKER} and nothing else.`,
].join(" ");

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function renderMetricValue(value: number | string): string {
  if (isFiniteNumber(value)) {
    return String(value);
  }
  if (typeof value === "number") {
    return "n/a";
  }
  return value;
}

function renderMetric(metric: ReportMetric): string {
  return `  - ${metric.label}: ${renderMetricValue(metric.value)}`;
}

function renderBlock(block: ReportBlock): string {
  const metrics = Array.isArray(block.metrics) ? block.metrics : [];
  const lines = [`Block (${block.kind}): ${block.title}`];
  if (metrics.length === 0) {
    lines.push("  (no metrics recorded for this block)");
  } else {
    for (const metric of metrics) {
      lines.push(renderMetric(metric));
    }
  }
  return lines.join("\n");
}

export function buildReportPrompt(input: ReportInput): { system: string; user: string } {
  const subject = typeof input.subject === "string" ? input.subject : "";
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];

  const lines = [`Subject: ${subject}`, "", "Allowed evidence (report blocks):"];

  if (blocks.length === 0) {
    lines.push("(no report blocks were supplied)");
  } else {
    for (const block of blocks) {
      lines.push(renderBlock(block));
      lines.push("");
    }
  }

  lines.push(
    "Narrate each block above using ONLY its supplied metric values, in the order given.",
  );

  return { system: SYSTEM_TEXT, user: lines.join("\n") };
}

function collectText(content: { type: string; text?: string }[]): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

function splitNarratives(text: string, count: number): string[] {
  if (count <= 0) {
    return [];
  }
  const parts = text.split(BLOCK_MARKER);
  const result: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const piece = typeof parts[i] === "string" ? parts[i].trim() : "";
    result.push(piece);
  }
  return result;
}

function literalValues(input: ReportInput): string[] {
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  const values: string[] = [];
  for (const block of blocks) {
    const metrics = Array.isArray(block.metrics) ? block.metrics : [];
    for (const metric of metrics) {
      values.push(renderMetricValue(metric.value));
    }
  }
  return values;
}

export async function composeReportBlocks(params: {
  input: ReportInput;
  client: AnalystClient;
  maxTokens?: number;
}): Promise<{
  blocks: { kind: string; title: string; narrative: string }[];
  groundedValues: string[];
}> {
  const { input, client } = params;
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  const prompt = buildReportPrompt(input);
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];

  const response = await client.messages.create({
    model: MODELS.analyst,
    max_tokens: maxTokens,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });

  const content = Array.isArray(response.content) ? response.content : [];
  const text = collectText(content);
  const narratives = splitNarratives(text, blocks.length);

  const narrated = blocks.map((block, index) => ({
    kind: block.kind,
    title: block.title,
    narrative: narratives[index] ?? "",
  }));

  return { blocks: narrated, groundedValues: literalValues(input) };
}

function extractNumericTokens(text: string): string[] {
  const matches = text.match(/\d+(?:\.\d+)?%?/g);
  return matches ?? [];
}

function normalizeNumber(token: string): string {
  const stripped = token.endsWith("%") ? token.slice(0, -1) : token;
  const value = Number(stripped);
  if (!Number.isFinite(value)) {
    return stripped;
  }
  return String(value);
}

function addTokensFrom(allowed: Set<string>, text: string): void {
  for (const token of extractNumericTokens(text)) {
    allowed.add(normalizeNumber(token));
  }
}

export function validateReportGrounding(
  text: string,
  input: ReportInput,
): { ok: boolean; unsupportedNumbers: string[] } {
  const allowed = new Set<string>();

  for (const value of literalValues(input)) {
    addTokensFrom(allowed, value);
  }

  const unsupportedNumbers: string[] = [];
  const seen = new Set<string>();

  for (const token of extractNumericTokens(typeof text === "string" ? text : "")) {
    const normalized = normalizeNumber(token);
    if (allowed.has(normalized)) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    unsupportedNumbers.push(token);
  }

  return { ok: unsupportedNumbers.length === 0, unsupportedNumbers };
}
