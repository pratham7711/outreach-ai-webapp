/**
 * The shape of a campaign's checklist, submission rules, launch date and view
 * goal, and the pure helpers over it: no database import, so client components
 * can use it. The reads and writes are in ./rules.
 */

export type CampaignRules = {
  dos: string[];
  donts: string[];
  examplePostUrls: string[];
  minFollowers: number | null;
  requiredHashtags: string[];
  requiredMentions: string[];
  maxPostsPerAccount: number | null;
  /** ISO instant, or null. */
  launchAt: string | null;
  viewGoal: number | null;
};

export const EMPTY_RULES: CampaignRules = {
  dos: [],
  donts: [],
  examplePostUrls: [],
  minFollowers: null,
  requiredHashtags: [],
  requiredMentions: [],
  maxPostsPerAccount: null,
  launchAt: null,
  viewGoal: null,
};

export const RULE_LIMITS = {
  listItems: 12,
  itemLength: 200,
  examples: 5,
  tags: 10,
  mentions: 5,
  maxFollowers: 1_000_000_000,
  maxPosts: 100,
  maxGoal: 2_000_000_000,
} as const;

/**
 * Per-campaign switches for features that change what creators or reviewers
 * can do. Each is off until the agency switches it on for that campaign
 * (Settings, "Optional features"), and a rules save never changes them.
 */
export const CAMPAIGN_SWITCHES = ["allowBoostCodes", "allowExclusions"] as const;
export type CampaignSwitch = (typeof CAMPAIGN_SWITCHES)[number];
export type CampaignSwitches = Record<CampaignSwitch, boolean>;
export const SWITCHES_OFF: CampaignSwitches = { allowBoostCodes: false, allowExclusions: false };

/** True when nothing on the row would change what anyone sees. */
export function rulesAreEmpty(r: CampaignRules): boolean {
  return (
    r.dos.length === 0 &&
    r.donts.length === 0 &&
    r.examplePostUrls.length === 0 &&
    r.minFollowers === null &&
    r.requiredHashtags.length === 0 &&
    r.requiredMentions.length === 0 &&
    r.maxPostsPerAccount === null &&
    r.launchAt === null &&
    r.viewGoal === null
  );
}

/** Whether the campaign has a launch date still ahead of `nowMs`. */
export function scheduledUntil(rules: Pick<CampaignRules, "launchAt"> | null | undefined, nowMs: number): string | null {
  if (!rules?.launchAt) return null;
  return new Date(rules.launchAt).getTime() > nowMs ? rules.launchAt : null;
}

/* ---------- input ---------- */

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

function list(raw: unknown, max: number, field: string, errors: string[]): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push(`${field} must be a list`);
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const v = clean(item);
    if (!v) continue;
    if (v.length > RULE_LIMITS.itemLength) {
      errors.push(`${field}: keep each item under ${RULE_LIMITS.itemLength} characters`);
      continue;
    }
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  if (out.length > max) errors.push(`${field}: at most ${max}`);
  return out.slice(0, max);
}

/** "#Tag", "tag", "# tag" -> "#tag"; anything with no letters or digits is dropped. */
export function normaliseHashtag(raw: string): string | null {
  const body = raw.trim().replace(/^#+/, "").replace(/\s+/g, "");
  if (!body || !/^[\p{L}\p{N}_]+$/u.test(body)) return null;
  return `#${body.toLowerCase()}`;
}

/** "@Handle", "handle" -> "@handle". Dots and underscores stay; spaces do not. */
export function normaliseMention(raw: string): string | null {
  const body = raw.trim().replace(/^@+/, "").replace(/\s+/g, "");
  if (!body || !/^[\p{L}\p{N}._]+$/u.test(body)) return null;
  return `@${body.toLowerCase()}`;
}

function signed(raw: unknown, max: number, field: string, norm: (s: string) => string | null, errors: string[]): string[] {
  const items = list(raw, 50, field, errors);
  const out: string[] = [];
  for (const i of items) {
    for (const part of i.split(/[\s,]+/)) {
      if (!part) continue;
      const n = norm(part);
      if (!n) errors.push(`${field}: "${part}" is not valid`);
      else if (!out.includes(n)) out.push(n);
    }
  }
  if (out.length > max) errors.push(`${field}: at most ${max}`);
  return out.slice(0, max);
}

function whole(raw: unknown, min: number, max: number, field: string, errors: string[]): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s]/g, ""));
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push(`${field} must be a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}`);
    return null;
  }
  return n;
}

function httpLink(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The editor's body, checked and normalised. Every field is optional and an
 * empty one clears that rule; `errors` names each field that could not be read
 * so the form can say which.
 */
export function parseRulesInput(body: unknown): { rules: CampaignRules; errors: string[] } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const examples: string[] = [];
  for (const raw of list(b.examplePostUrls, RULE_LIMITS.examples, "Example posts", errors)) {
    const link = httpLink(raw);
    if (!link) errors.push(`Example posts: "${raw}" is not a link`);
    else examples.push(link);
  }
  let launchAt: string | null = null;
  if (b.launchAt !== undefined && b.launchAt !== null && b.launchAt !== "") {
    const t = new Date(String(b.launchAt));
    if (Number.isNaN(t.getTime())) errors.push("Launch date is not a date");
    else launchAt = t.toISOString();
  }
  return {
    rules: {
      dos: list(b.dos, RULE_LIMITS.listItems, "Do", errors),
      donts: list(b.donts, RULE_LIMITS.listItems, "Don't", errors),
      examplePostUrls: examples,
      minFollowers: whole(b.minFollowers, 1, RULE_LIMITS.maxFollowers, "Minimum followers", errors),
      requiredHashtags: signed(b.requiredHashtags, RULE_LIMITS.tags, "Hashtags", normaliseHashtag, errors),
      requiredMentions: signed(b.requiredMentions, RULE_LIMITS.mentions, "Mentions", normaliseMention, errors),
      maxPostsPerAccount: whole(b.maxPostsPerAccount, 1, RULE_LIMITS.maxPosts, "Posts per account", errors),
      launchAt,
      viewGoal: whole(b.viewGoal, 1, RULE_LIMITS.maxGoal, "View goal", errors),
    },
    errors,
  };
}

/* ---------- display ---------- */

/** "1.38M of 1M goal (138%)" pieces. Null without a goal or without measured views. */
export function viewGoalProgress(views: number | null | undefined, goal: number | null | undefined): { pct: number; reached: boolean } | null {
  if (!goal || goal <= 0 || views == null || !Number.isFinite(views)) return null;
  const pct = Math.round((views / goal) * 100);
  return { pct, reached: views >= goal };
}
