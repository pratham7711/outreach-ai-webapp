import { z } from "zod";
import { MODELS } from "@/lib/ai/models";

export interface AnalystClient {
  messages: {
    create(args: unknown): Promise<{ content: { type: string; text?: string }[] }>;
  };
}

export const EvidenceItemSchema = z.object({
  label: z.string().min(1),
  value: z.union([z.string(), z.number()]),
});

export const OutreachDraftInputSchema = z.object({
  handle: z.string().min(1),
  name: z.string().optional(),
  brief: z.string().min(1),
  evidence: z.array(EvidenceItemSchema).default([]),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type OutreachDraftInput = z.infer<typeof OutreachDraftInputSchema>;

const DEFAULT_MAX_TOKENS = 1024;

export const OUTREACH_DRAFT_ONLY_NOTICE =
  "This composer ONLY drafts copy. It NEVER sends. No message is delivered here; sending stays behind the approval-gated send_invite/draft_outreach tool.";

const SYSTEM_TEXT = [
  "You draft a personalized outreach message to a creator for an influencer-marketing campaign.",
  "You ONLY produce draft copy. You NEVER send anything; this step does NOT send. Sending is handled elsewhere behind an approval gate.",
  "You may ONLY reference the campaign brief and the EVIDENCE facts provided below.",
  "Do NOT introduce any number, percentage, follower count, engagement rate, statistic, or claim that is not present in the provided evidence.",
  "Do NOT invent metrics, benchmarks, industry averages, prior collaborations, or comparisons.",
  "If a fact is not in the evidence, omit it rather than fabricating a figure.",
  "Use ONLY the supplied evidence; cite no fact that is not grounded in it.",
  "Output the subject line on the first line, then the message body on the following lines.",
].join(" ");

function formatValue(value: string | number): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "unknown";
  }
  return value;
}

function renderEvidence(item: EvidenceItem): string {
  return `- ${item.label}: ${formatValue(item.value)}`;
}

function coerceInput(input: OutreachDraftInput): {
  handle: string;
  name?: string;
  brief: string;
  evidence: EvidenceItem[];
} {
  const parsed = OutreachDraftInputSchema.parse(input);
  return {
    handle: parsed.handle,
    name: parsed.name,
    brief: parsed.brief,
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
  };
}

export function buildOutreachPrompt(input: OutreachDraftInput): { system: string; user: string } {
  const { handle, name, brief, evidence } = coerceInput(input);

  const lines: string[] = [];
  lines.push(OUTREACH_DRAFT_ONLY_NOTICE);
  lines.push("");
  lines.push(`Creator handle: ${handle}`);
  if (typeof name === "string" && name.length > 0) {
    lines.push(`Creator name: ${name}`);
  }
  lines.push("");
  lines.push("Campaign brief:");
  lines.push(brief);
  lines.push("");
  lines.push("Allowed evidence (the ONLY facts you may cite):");

  if (evidence.length === 0) {
    lines.push("(no evidence facts were supplied; cite no numbers or metrics)");
  } else {
    for (const item of evidence) {
      lines.push(renderEvidence(item));
    }
  }

  lines.push("");
  lines.push(
    "Draft an outreach message using ONLY the brief and evidence above. Do NOT introduce facts not listed. First line is the subject; the rest is the body.",
  );

  return {
    system: SYSTEM_TEXT,
    user: lines.join("\n"),
  };
}

function collectText(content: { type: string; text?: string }[]): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

function parseDraft(text: string): { subject: string; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  const newlineIndex = normalized.indexOf("\n");
  if (newlineIndex === -1) {
    return { subject: normalized.trim(), body: "" };
  }
  const subject = normalized.slice(0, newlineIndex).trim();
  const body = normalized.slice(newlineIndex + 1).replace(/^\n+/, "");
  return { subject, body };
}

export async function draftOutreach(params: {
  input: OutreachDraftInput;
  client: AnalystClient;
  maxTokens?: number;
}): Promise<{ subject: string; body: string; groundedFacts: string[] }> {
  const { input, client } = params;
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  const coerced = coerceInput(input);
  const prompt = buildOutreachPrompt(input);

  const response = await client.messages.create({
    model: MODELS.analyst,
    max_tokens: maxTokens,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });

  const content = Array.isArray(response.content) ? response.content : [];
  const text = collectText(content);
  const { subject, body } = parseDraft(text);
  const groundedFacts = coerced.evidence.map((item) => item.label);

  return { subject, body, groundedFacts };
}

function extractNumericTokens(text: string): string[] {
  const matches = text.match(/\d+(?:,\d{3})*(?:\.\d+)?%?/g);
  return matches ?? [];
}

function normalizeNumber(token: string): string {
  const noCommas = token.replace(/,/g, "");
  const stripped = noCommas.endsWith("%") ? noCommas.slice(0, -1) : noCommas;
  const value = Number(stripped);
  if (!Number.isFinite(value)) return stripped;
  return String(value);
}

function addTokensFrom(allowed: Set<string>, text: string): void {
  for (const token of extractNumericTokens(text)) {
    allowed.add(normalizeNumber(token));
  }
}

export function validateOutreachGrounding(
  text: string,
  input: OutreachDraftInput,
): { ok: boolean; unsupportedNumbers: string[] } {
  const { evidence } = coerceInput(input);
  const allowed = new Set<string>();

  for (const item of evidence) {
    addTokensFrom(allowed, formatValue(item.value));
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
