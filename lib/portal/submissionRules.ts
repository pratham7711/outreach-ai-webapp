import type { CampaignRules } from "@/lib/campaigns/rulesShape";

/**
 * The campaign's submission rules, checked against what we have measured.
 *
 * Only measurable rules exist, and an unmeasured value never refuses a post:
 * a follower count we have not read lets the post through with the note
 * "Followers not measured", and a caption the platform did not return lets it
 * through with "Caption not read". Both notes travel with the post to the
 * agency, which reviews every portal submission anyway (PENDING_REVIEW).
 *
 * The creator sees the same checks before submitting. A caption cannot be
 * checked until the link is read, so before submit those rules show as
 * "checked when you submit".
 */

export type RuleState = "pass" | "fail" | "unknown" | "pending";

export type RuleCheck = {
  key: "followers" | "hashtags" | "mentions" | "postsPerAccount";
  label: string;
  state: RuleState;
  detail: string;
};

export type FollowerReading = { count: number; at: string | null } | null;

export type RuleInputs = {
  /** The creator's latest follower reading on the post's platform; null when not measured. */
  followers: FollowerReading;
  /** The post's caption: a string when read, null when the read returned none,
      undefined before the link has been read (the pre-submit view). */
  caption?: string | null;
  /** Live posts this creator already has on the campaign, on this platform. */
  postsOnAccount: number;
  platformLabel?: string;
};

const fmt = (n: number) => n.toLocaleString("en-US");

function readOn(at: string | null): string {
  if (!at) return "";
  return ` (read ${new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })})`;
}

/** Words in a caption, lower-cased, that start with the given sign. */
function signedWords(caption: string, sign: "#" | "@"): Set<string> {
  const re = sign === "#" ? /#[\p{L}\p{N}_]+/gu : /@[\p{L}\p{N}._]+/gu;
  return new Set((caption.match(re) ?? []).map((w) => w.toLowerCase().replace(/\.+$/, "")));
}

export function checkSubmissionRules(rules: CampaignRules | null, input: RuleInputs): RuleCheck[] {
  if (!rules) return [];
  const checks: RuleCheck[] = [];

  if (rules.minFollowers) {
    const f = input.followers;
    const label = `Needs ${fmt(rules.minFollowers)} followers`;
    if (!f || !(f.count > 0)) {
      checks.push({
        key: "followers",
        label,
        state: "unknown",
        detail: `Followers not measured${input.platformLabel ? ` on ${input.platformLabel}` : ""}. You can still submit; the agency will check.`,
      });
    } else {
      checks.push({
        key: "followers",
        label,
        state: f.count >= rules.minFollowers ? "pass" : "fail",
        detail: `Yours${input.platformLabel ? ` on ${input.platformLabel}` : ""}: ${fmt(Math.round(f.count))}${readOn(f.at)}`,
      });
    }
  }

  const captionRule = (key: "hashtags" | "mentions", wanted: string[], sign: "#" | "@") => {
    if (wanted.length === 0) return;
    const label = `Caption includes ${wanted.join(" ")}`;
    if (input.caption === undefined) {
      checks.push({ key, label, state: "pending", detail: "Checked when you submit." });
      return;
    }
    if (input.caption === null || input.caption.trim() === "") {
      checks.push({ key, label, state: "unknown", detail: "Caption not read. The agency will check." });
      return;
    }
    const have = signedWords(input.caption, sign);
    const missing = wanted.filter((w) => !have.has(w.toLowerCase()));
    checks.push({
      key,
      label,
      state: missing.length === 0 ? "pass" : "fail",
      detail: missing.length === 0 ? "Found in the caption." : `Missing from the caption: ${missing.join(" ")}`,
    });
  };
  captionRule("hashtags", rules.requiredHashtags, "#");
  captionRule("mentions", rules.requiredMentions, "@");

  if (rules.maxPostsPerAccount) {
    const used = input.postsOnAccount;
    checks.push({
      key: "postsPerAccount",
      label: `Up to ${rules.maxPostsPerAccount} post${rules.maxPostsPerAccount === 1 ? "" : "s"} per account`,
      state: used < rules.maxPostsPerAccount ? "pass" : "fail",
      detail: `You've submitted ${used}${input.platformLabel ? ` on ${input.platformLabel}` : ""}.`,
    });
  }
  return checks;
}

/** The first failed rule, worded as the refusal. Null when nothing fails. */
export function blockingRule(checks: RuleCheck[]): string | null {
  const f = checks.find((c) => c.state === "fail");
  return f ? `${f.label}. ${f.detail}` : null;
}

/** What the agency is told about a post that went through unchecked. */
export function ruleNotes(checks: RuleCheck[]): string[] {
  const notes: string[] = [];
  for (const c of checks) {
    if (c.state !== "unknown") continue;
    notes.push(c.key === "followers" ? "Followers not measured" : "Caption not read");
  }
  return [...new Set(notes)];
}
