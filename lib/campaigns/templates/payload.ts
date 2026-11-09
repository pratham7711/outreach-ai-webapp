import { z } from "zod";

/**
 * A campaign's setup: what a template carries and what "copy a past campaign"
 * copies. No database import, so the New Campaign form and the Save as
 * template dialog use the same shape and the same summaries the server does.
 *
 * Setup only. It carries the client, the budget and its currency, the post
 * approval mode, the notes, the creative brief's content, the campaign rules
 * (not the launch date or the example posts, which belong to one campaign) and
 * the phases (name, order and target, not their dates). It never carries the
 * title, sound or song links, the picture, posts, creators or activations, the
 * status, the folder, financial rollups or any imported `cc*` field: none of
 * those is a field here, so none can be copied by accident.
 *
 * A null field is "not carried": applying the setup leaves that field to the
 * form or to its default.
 */

export const SETUP_VERSION = 1 as const;

export const SETUP_CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const;
export const SETUP_APPROVAL_MODES = ["MANUAL", "AUTO_APPROVED"] as const;

/* Generous ceilings: they stop the column being used as storage, not real
   campaigns being saved. Imported campaigns were never held to the editor's
   limits, so the editor's limits are not used here. */
const text = (max: number) => z.string().max(max);

export const setupRulesSchema = z.object({
  dos: z.array(text(2000)).max(100),
  donts: z.array(text(2000)).max(100),
  requiredHashtags: z.array(text(200)).max(100),
  requiredMentions: z.array(text(200)).max(100),
  minFollowers: z.number().int().nonnegative().nullable(),
  maxPostsPerAccount: z.number().int().nonnegative().nullable(),
  viewGoal: z.number().int().nonnegative().nullable(),
  allowExclusions: z.boolean(),
  allowBoostCodes: z.boolean(),
});

export const setupPhaseSchema = z.object({
  name: z.string().min(1).max(500),
  sequence: z.number().int().positive(),
  targetPosts: z.number().int().nonnegative().nullable(),
});

export const campaignSetupSchema = z.object({
  version: z.literal(SETUP_VERSION),
  clientId: z.string().min(1).nullable(),
  budget: z.number().finite().nonnegative().nullable(),
  currency: z.enum(SETUP_CURRENCIES).nullable(),
  postApprovalMode: z.enum(SETUP_APPROVAL_MODES).nullable(),
  notes: text(20_000).nullable(),
  /** CreativeBrief.content, the editor's HTML, verbatim. */
  brief: text(100_000).nullable(),
  rules: setupRulesSchema.nullable(),
  phases: z.array(setupPhaseSchema).max(100),
});

export type CampaignSetup = z.infer<typeof campaignSetupSchema>;
export type SetupRules = z.infer<typeof setupRulesSchema>;
export type SetupPhase = z.infer<typeof setupPhaseSchema>;

export const EMPTY_SETUP: CampaignSetup = {
  version: SETUP_VERSION,
  clientId: null,
  budget: null,
  currency: null,
  postApprovalMode: null,
  notes: null,
  brief: null,
  rules: null,
  phases: [],
};

/** A stored payload, checked. Null for anything this version cannot read. */
export function parseSetup(raw: unknown): CampaignSetup | null {
  const parsed = campaignSetupSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/* ---------- parts ---------- */

/** The pieces a person can see and switch off when saving a template. */
export const SETUP_PARTS = ["client", "budget", "approval", "notes", "brief", "rules", "phases"] as const;
export type SetupPart = (typeof SETUP_PARTS)[number];
export type SetupInclude = Partial<Record<SetupPart, boolean>>;

/** True when the editor's HTML holds no words: an empty brief is not a brief. */
export function briefIsEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim() === "";
}

/** The number of rules a person set: each checklist line, tag and mention, each limit and goal, each switch on. */
export function ruleCount(rules: SetupRules | null | undefined): number {
  if (!rules) return 0;
  return (
    rules.dos.length +
    rules.donts.length +
    rules.requiredHashtags.length +
    rules.requiredMentions.length +
    [rules.minFollowers, rules.maxPostsPerAccount, rules.viewGoal].filter((n) => n !== null).length +
    [rules.allowExclusions, rules.allowBoostCodes].filter(Boolean).length
  );
}

/** Which parts this setup actually has. Approval always has a value once carried. */
export function partsPresent(setup: CampaignSetup): SetupPart[] {
  const out: SetupPart[] = [];
  if (setup.clientId) out.push("client");
  if (setup.budget !== null) out.push("budget");
  if (setup.postApprovalMode) out.push("approval");
  if (setup.notes && setup.notes.trim()) out.push("notes");
  if (!briefIsEmpty(setup.brief)) out.push("brief");
  if (ruleCount(setup.rules) > 0) out.push("rules");
  if (setup.phases.length > 0) out.push("phases");
  return out;
}

/** The setup with every part switched off set to "not carried". Missing keys count as on. */
export function withParts(setup: CampaignSetup, include: SetupInclude | undefined): CampaignSetup {
  const on = (p: SetupPart) => include?.[p] !== false;
  return {
    version: SETUP_VERSION,
    clientId: on("client") ? setup.clientId : null,
    budget: on("budget") ? setup.budget : null,
    /* The currency travels with the budget: without one it names nothing. */
    currency: on("budget") && setup.budget !== null ? setup.currency : null,
    postApprovalMode: on("approval") ? setup.postApprovalMode : null,
    notes: on("notes") && setup.notes?.trim() ? setup.notes : null,
    brief: on("brief") && !briefIsEmpty(setup.brief) ? setup.brief : null,
    rules: on("rules") && ruleCount(setup.rules) > 0 ? setup.rules : null,
    phases: on("phases") ? setup.phases : [],
  };
}

/* ---------- summaries ---------- */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a list row says about a setup, without shipping the brief's HTML. */
export type SetupSummary = {
  client: boolean;
  budget: { amount: number; currency: string | null } | null;
  approval: (typeof SETUP_APPROVAL_MODES)[number] | null;
  notes: boolean;
  brief: boolean;
  rules: number;
  phases: number;
};

export function summarise(setup: CampaignSetup): SetupSummary {
  return {
    client: Boolean(setup.clientId),
    budget: setup.budget === null ? null : { amount: setup.budget, currency: setup.currency },
    approval: setup.postApprovalMode,
    notes: Boolean(setup.notes && setup.notes.trim()),
    brief: !briefIsEmpty(setup.brief),
    rules: ruleCount(setup.rules),
    phases: setup.phases.length,
  };
}

/**
 * "the brief, 3 rules and 2 phases": what comes along beyond the fields the
 * form shows. Null when nothing does.
 */
export function alsoCopies(summary: Pick<SetupSummary, "brief" | "rules" | "phases">): string | null {
  const items = [
    summary.brief ? "the brief" : null,
    summary.rules > 0 ? plural(summary.rules, "rule") : null,
    summary.phases > 0 ? plural(summary.phases, "phase") : null,
  ].filter((s): s is string => s !== null);
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** One short line for a template row: "Client · $5,000 · brief · 3 rules · 2 phases". */
export function summaryLine(summary: SetupSummary, clientName?: string | null): string {
  const bits = [
    summary.client ? clientName || "Client" : null,
    summary.budget ? formatBudget(summary.budget.amount, summary.budget.currency) : null,
    summary.brief ? "brief" : null,
    summary.rules > 0 ? plural(summary.rules, "rule") : null,
    summary.phases > 0 ? plural(summary.phases, "phase") : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "Approval mode only";
}

export function formatBudget(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US")} ${currency ?? ""}`.trim();
  }
}

export const APPROVAL_LABEL: Record<(typeof SETUP_APPROVAL_MODES)[number], string> = {
  MANUAL: "Manual review",
  AUTO_APPROVED: "Auto-approved",
};

/** The rules, in words, for the Save as template list: "2 dos, 1 don't, #summer, min 10K followers". */
export function describeRules(rules: SetupRules | null): string {
  if (!rules) return "";
  const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
  const bits = [
    rules.dos.length ? plural(rules.dos.length, "do", "dos") : null,
    rules.donts.length ? plural(rules.donts.length, "don't", "don'ts") : null,
    rules.requiredHashtags.length ? rules.requiredHashtags.join(" ") : null,
    rules.requiredMentions.length ? rules.requiredMentions.join(" ") : null,
    rules.minFollowers !== null ? `min ${compact(rules.minFollowers)} followers` : null,
    rules.maxPostsPerAccount !== null ? `${plural(rules.maxPostsPerAccount, "post")} per account` : null,
    rules.viewGoal !== null ? `${compact(rules.viewGoal)} view goal` : null,
    rules.allowExclusions ? "exclusions on" : null,
    rules.allowBoostCodes ? "boost codes on" : null,
  ].filter(Boolean);
  return bits.join(", ");
}

/** The brief's length in words, for "Creative brief · 240 words". */
export function briefWords(html: string | null): number {
  if (briefIsEmpty(html)) return 0;
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim().split(/\s+/).length;
}

/* ---------- the API's request shapes ---------- */

export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_DESCRIPTION_MAX = 280;

export const setupFromSchema = z.object({
  kind: z.enum(["template", "campaign"]),
  id: z.string().min(1).max(100),
});
export type SetupFrom = z.infer<typeof setupFromSchema>;
