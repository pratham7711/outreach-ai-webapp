import { EMPTY_RULES, type CampaignRules } from "@/lib/campaigns/rulesShape";
import { blockingRule, checkSubmissionRules, ruleNotes } from "@/lib/portal/submissionRules";

const rules = (over: Partial<CampaignRules>): CampaignRules => ({ ...EMPTY_RULES, ...over });
const base = { followers: null, postsOnAccount: 0, platformLabel: "TikTok" } as const;

describe("checkSubmissionRules", () => {
  it("checks nothing when the campaign has no rules", () => {
    expect(checkSubmissionRules(null, base)).toEqual([]);
    expect(checkSubmissionRules(EMPTY_RULES, base)).toEqual([]);
  });

  it("never refuses on a follower count it has not measured, and says so", () => {
    const checks = checkSubmissionRules(rules({ minFollowers: 10_000 }), base);
    expect(checks[0].state).toBe("unknown");
    expect(blockingRule(checks)).toBeNull();
    expect(ruleNotes(checks)).toEqual(["Followers not measured"]);
  });

  it("treats a 0 reading as not measured, never as zero followers", () => {
    const checks = checkSubmissionRules(rules({ minFollowers: 10 }), { ...base, followers: { count: 0, at: null } });
    expect(checks[0].state).toBe("unknown");
  });

  it("passes and fails on a measured count, naming the reading", () => {
    const pass = checkSubmissionRules(rules({ minFollowers: 10_000 }), { ...base, followers: { count: 25_000, at: "2026-10-20T00:00:00Z" } });
    expect(pass[0]).toMatchObject({ state: "pass", detail: "Yours on TikTok: 25,000 (read 20 Oct)" });
    const fail = checkSubmissionRules(rules({ minFollowers: 10_000 }), { ...base, followers: { count: 9_999, at: null } });
    expect(fail[0].state).toBe("fail");
    expect(blockingRule(fail)).toBe("Needs 10,000 followers. Yours on TikTok: 9,999");
    const unnamed = checkSubmissionRules(rules({ minFollowers: 10_000 }), { ...base, followers: { count: 25_000, at: null }, platformLabel: undefined });
    expect(unnamed[0].detail).toBe("Yours: 25,000");
  });

  it("holds caption rules as pending before the link is read", () => {
    const checks = checkSubmissionRules(rules({ requiredHashtags: ["#drop"], requiredMentions: ["@brand"] }), base);
    expect(checks.map((c) => c.state)).toEqual(["pending", "pending"]);
    expect(blockingRule(checks)).toBeNull();
    expect(ruleNotes(checks)).toEqual([]);
  });

  it("lets an unread caption through with a note", () => {
    const checks = checkSubmissionRules(rules({ requiredHashtags: ["#drop"] }), { ...base, caption: null });
    expect(checks[0].state).toBe("unknown");
    expect(ruleNotes(checks)).toEqual(["Caption not read"]);
  });

  it("matches tags and mentions whole and case-insensitively", () => {
    const r = rules({ requiredHashtags: ["#drop"], requiredMentions: ["@brand.co"] });
    const ok = checkSubmissionRules(r, { ...base, caption: "Out now #DROP with @Brand.co." });
    expect(ok.map((c) => c.state)).toEqual(["pass", "pass"]);
    // #dropped is not #drop, and @brand is not @brand.co.
    const bad = checkSubmissionRules(r, { ...base, caption: "#dropped @brand" });
    expect(bad.map((c) => c.state)).toEqual(["fail", "fail"]);
    expect(blockingRule(bad)).toMatch(/Missing from the caption: #drop/);
  });

  it("allows posts up to the per-account limit and refuses the next", () => {
    const r = rules({ maxPostsPerAccount: 2 });
    expect(checkSubmissionRules(r, { ...base, postsOnAccount: 1 })[0].state).toBe("pass");
    const at = checkSubmissionRules(r, { ...base, postsOnAccount: 2 });
    expect(at[0].state).toBe("fail");
    expect(at[0].detail).toBe("You've submitted 2 on TikTok.");
  });

  it("reports each kind of unchecked rule once", () => {
    const checks = checkSubmissionRules(rules({ minFollowers: 5, requiredHashtags: ["#a"], requiredMentions: ["@b"] }), { ...base, caption: "" });
    expect(ruleNotes(checks)).toEqual(["Followers not measured", "Caption not read"]);
  });
});
