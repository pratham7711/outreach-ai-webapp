import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProfileSource } from "@/lib/creatorFinder/liveProfile";
import { SCOUT_MODEL, responseText, type ScoutAiClient } from "@/lib/creatorFinder/scoutAi";

/**
 * What a creator makes, and how to reach them, read from their own profile
 * text by the AI. No platform has a niche field, so "Brazilian funk dance
 * creators" or "car-edit creators who use phonk" can't be filtered without it.
 *
 * Every tag and contact must quote the profile: a quote that is not in the
 * source it names is thrown out here, before anyone sees it. The AI never
 * produces a number and never guesses a contact that isn't written down.
 */

export const TAG_KINDS = ["content", "language", "city", "brand_safety"] as const;
export type TagKind = (typeof TAG_KINDS)[number];
export const CONTACT_KINDS = ["email", "booking", "website", "whatsapp", "phone", "manager"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export type AiTag = { kind: TagKind; label: string; source: string };
export type QuotedTag = AiTag & { quote: string };
export type QuotedContact = { kind: ContactKind; value: string; source: string; quote: string };

export type StoredAiTags = {
  tags: AiTag[];
  rejected: Array<{ kind: TagKind; label: string; by: string | null; at: string }>;
  model: string;
  at: string;
  /** SHA-256 of the exact text the model read. The text itself is not kept. */
  inputDigest: string;
};

const MAX_TAGS = 12;
const MAX_CONTACTS = 6;
const LABEL_MAX = 40;

/* Structured output: the model can only answer in this shape. */
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tags", "contacts"],
  properties: {
    tags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "label", "source", "quote"],
        properties: {
          kind: { type: "string", enum: [...TAG_KINDS] },
          label: { type: "string" },
          source: { type: "string" },
          quote: { type: "string" },
        },
      },
    },
    contacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "value", "source", "quote"],
        properties: {
          kind: { type: "string", enum: [...CONTACT_KINDS] },
          value: { type: "string" },
          source: { type: "string" },
          quote: { type: "string" },
        },
      },
    },
  },
} as const;

const OutputSchema = z.object({
  tags: z.array(z.object({ kind: z.enum(TAG_KINDS), label: z.string(), source: z.string(), quote: z.string() })),
  contacts: z.array(z.object({ kind: z.enum(CONTACT_KINDS), value: z.string(), source: z.string(), quote: z.string() })),
});

const SYSTEM = [
  "You label a social media creator's profile for a music label's A&R team, who look for creators to make videos with their songs.",
  "You are given the creator's own profile text, split into sources, each with an id.",
  "Tags:",
  "- content: what the creator makes, in 1-3 words, such as car edits, anime edits, football edits, gym edits, dance, passinho, lip-sync, memes, music production, DJ sets.",
  "- language: the language the creator writes or speaks in, such as Portuguese or English.",
  "- city: only a city or country the creator states as where they are.",
  "- brand_safety: only content a brand would want to know about before working with them, such as explicit language, violence, gambling, drugs or politics.",
  "Contacts: an email, booking contact, website, WhatsApp or phone number, or manager the profile itself gives for business enquiries. Rewrite an obfuscated email (name at gmail dot com) as an address.",
  "Rules:",
  "- Every tag and contact quotes the exact words it came from, copied character for character from ONE source, and names that source's id.",
  "- Leave a kind out rather than guess. Never invent a contact, never give a number such as a follower count, never judge quality.",
  "- Labels are short, lower case, and in English.",
].join("\n");

export function buildTagsPrompt(sources: ProfileSource[], platform: string): string {
  const lines = [`Platform: ${platform === "YOUTUBE" ? "YouTube" : "Instagram"}`, ""];
  for (const s of sources) {
    lines.push(`<source id="${s.id}" kind="${s.label}"${s.at ? ` date="${s.at.slice(0, 10)}"` : ""}>`);
    lines.push(s.text);
    lines.push("</source>");
  }
  return lines.join("\n");
}

export function inputDigest(sources: ProfileSource[]): string {
  return createHash("sha256").update(JSON.stringify(sources.map((s) => [s.id, s.text]))).digest("hex");
}

function squash(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The quote is really in the source it names. */
function quoted(sources: Map<string, ProfileSource>, sourceId: string, quote: string): boolean {
  const src = sources.get(sourceId);
  const q = squash(quote);
  return !!src && q.length >= 2 && squash(src.text).includes(q);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * A contact must be readable off its quote: an email's every word piece, a
 * site's host, a number's digits. "Rewritten from 'name at gmail dot com'" is
 * fine; an address the quote doesn't spell out is not.
 */
function contactInQuote(kind: ContactKind, value: string, quote: string): boolean {
  const v = value.trim();
  const q = squash(quote);
  if (!v) return false;
  if (kind === "email") {
    if (!EMAIL.test(v)) return false;
    return v
      .toLowerCase()
      .split(/[@.]/)
      .filter(Boolean)
      .every((piece) => q.includes(piece));
  }
  if (kind === "whatsapp" || kind === "phone") {
    const digits = v.replace(/\D/g, "");
    return digits.length >= 7 && q.replace(/\D/g, "").includes(digits);
  }
  if (kind === "website") {
    const host = v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
    return host.length > 3 && q.includes(host);
  }
  return q.includes(squash(v));
}

export type ProfileSignals = {
  tags: QuotedTag[];
  contacts: QuotedContact[];
  /** How many of the model's answers failed the quote check and were dropped. */
  dropped: number;
};

/**
 * Keep only what the profile itself supports, drop anything the agency has
 * already marked wrong, and cap the counts.
 */
export function checkSignals(
  raw: z.infer<typeof OutputSchema>,
  sourceList: ProfileSource[],
  rejected: Array<{ kind: string; label: string }> = [],
): ProfileSignals {
  const sources = new Map(sourceList.map((s) => [s.id, s]));
  const wrong = new Set(rejected.map((r) => `${r.kind}:${squash(r.label)}`));
  let dropped = 0;

  const tags: QuotedTag[] = [];
  const seen = new Set<string>();
  for (const t of raw.tags) {
    const label = squash(t.label).slice(0, LABEL_MAX);
    const key = `${t.kind}:${label}`;
    if (!label || /\d/.test(label) || !quoted(sources, t.source, t.quote)) {
      dropped++;
      continue;
    }
    if (seen.has(key) || wrong.has(key)) continue;
    seen.add(key);
    tags.push({ kind: t.kind, label, source: t.source, quote: t.quote.trim() });
  }

  const contacts: QuotedContact[] = [];
  const seenContacts = new Set<string>();
  for (const c of raw.contacts) {
    if (!quoted(sources, c.source, c.quote) || !contactInQuote(c.kind, c.value, c.quote)) {
      dropped++;
      continue;
    }
    const key = `${c.kind}:${c.value.trim().toLowerCase()}`;
    if (seenContacts.has(key)) continue;
    seenContacts.add(key);
    contacts.push({ kind: c.kind, value: c.value.trim(), source: c.source, quote: c.quote.trim() });
  }

  return { tags: tags.slice(0, MAX_TAGS), contacts: contacts.slice(0, MAX_CONTACTS), dropped };
}

export class ScoutAiAnswerError extends Error {}

export async function readProfileSignals(params: {
  client: ScoutAiClient;
  sources: ProfileSource[];
  platform: string;
  rejected?: Array<{ kind: string; label: string }>;
}): Promise<ProfileSignals> {
  const { client, sources, platform } = params;
  if (!sources.length) return { tags: [], contacts: [], dropped: 0 };
  const response = await client.messages.create({
    model: SCOUT_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: buildTagsPrompt(sources, platform) }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens")
    throw new ScoutAiAnswerError(`The AI stopped early (${response.stop_reason}).`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText(response.content));
  } catch {
    throw new ScoutAiAnswerError("The AI's answer wasn't readable.");
  }
  const out = OutputSchema.safeParse(parsed);
  if (!out.success) throw new ScoutAiAnswerError("The AI's answer wasn't in the expected shape.");
  return checkSignals(out.data, sources, params.rejected);
}

/** The stored column, read defensively: anything malformed reads as no tags. */
export function readStoredTags(value: unknown): StoredAiTags | null {
  const v = value as Partial<StoredAiTags> | null;
  if (!v || typeof v !== "object" || !Array.isArray(v.tags)) return null;
  return {
    tags: v.tags.filter((t): t is AiTag => !!t && (TAG_KINDS as readonly string[]).includes(t.kind) && typeof t.label === "string"),
    rejected: Array.isArray(v.rejected) ? v.rejected : [],
    model: typeof v.model === "string" ? v.model : "",
    at: typeof v.at === "string" ? v.at : "",
    inputDigest: typeof v.inputDigest === "string" ? v.inputDigest : "",
  };
}

export function isTagKind(value: unknown): value is TagKind {
  return typeof value === "string" && (TAG_KINDS as readonly string[]).includes(value);
}
