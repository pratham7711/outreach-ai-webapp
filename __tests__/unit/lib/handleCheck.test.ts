/**
 * @jest-environment node
 */
import { HANDLE_PROBLEM_WHERE, handleIssueSummary, handleProblem, handleProblemText } from "@/lib/creators/handleCheck";
import { countCreatorFilters, creatorWhere, readCreatorFilters } from "@/lib/listFilters";

describe("handleProblem", () => {
  it("flags an account the platform says does not exist, on any platform", () => {
    expect(handleProblem("TIKTOK", "no-such-account: statusCode 10221")).toBe("not-found");
    expect(handleProblem("TIKTOK", "no-such-account: http 404")).toBe("not-found");
    expect(handleProblem("YOUTUBE", "no-such-account: no channel for handle")).toBe("not-found");
    expect(handleProblem("TIKTOK", "no-such-account")).toBe("not-found");
  });

  // Business Discovery gives a misspelt handle and a personal account the same silence.
  it("flags an Instagram account Business Discovery cannot see as possibly either", () => {
    expect(handleProblem("INSTAGRAM", "not-a-professional-account")).toBe("not-found-or-personal");
  });

  it("never flags a busy hour, a missing token or a read that only lacked numbers", () => {
    expect(handleProblem("INSTAGRAM", "rate-limited: Graph rate limit (#4)")).toBeNull();
    expect(handleProblem("TIKTOK", "unreadable: no userInfo")).toBeNull();
    expect(handleProblem("YOUTUBE", "no-credentials")).toBeNull();
    expect(handleProblem("TIKTOK", null)).toBeNull();
    expect(handleProblem("TIKTOK", undefined)).toBeNull();
  });

  it("reads the reason from a stored error that carries a note on a second line", () => {
    expect(handleProblem("TIKTOK", "no-such-account\nsandbox: statusCode 10221")).toBe("not-found");
  });
});

describe("handleProblemText", () => {
  it("says which platform could not find which handle", () => {
    expect(handleProblemText("TIKTOK", "synthfixx", "not-found")).toMatch(/^TikTok has no account called @synthfixx\. It was deleted or renamed/);
    expect(handleProblemText("INSTAGRAM", "@synth.fix", "not-found-or-personal")).toMatch(
      /^Instagram can't find a Business or Creator account called @synth\.fix\. It's personal, private or deleted/,
    );
  });
});

describe("handleIssueSummary", () => {
  it("leads with deleted accounts and names the Instagram ones it can't read apart", () => {
    expect(handleIssueSummary(272, 129)).toBe(
      "272 creators have an account that was deleted or renamed. 129 more have an Instagram account that's personal, private or deleted, so its numbers can't be read.",
    );
  });

  it("drops the half with nothing in it, and reads a single creator in the singular", () => {
    expect(handleIssueSummary(1, 0)).toBe("1 creator has an account that was deleted or renamed.");
    expect(handleIssueSummary(0, 1)).toBe("1 creator has an Instagram account that's personal, private or deleted, so its numbers can't be read.");
    expect(handleIssueSummary(1_204, 1)).toMatch(/^1,204 creators have .* 1 more has an Instagram account/);
    expect(handleIssueSummary(0, 0)).toBeNull();
  });
});

describe("the Account not found filter", () => {
  it("reads from the URL and counts as one filter", () => {
    const f = readCreatorFilters({ handleIssues: "1" });
    expect(f.handleIssues).toBe(true);
    expect(countCreatorFilters(f)).toBe(1);
    expect(readCreatorFilters({}).handleIssues).toBeUndefined();
  });

  it("matches creators holding a flagged account, on the roster tables only", () => {
    const f = readCreatorFilters({ handleIssues: "1" });
    expect(creatorWhere("org-1", f, { roster: true }).AND).toContainEqual({ profileLinks: { some: HANDLE_PROBLEM_WHERE } });
    expect(creatorWhere("org-1", f, { roster: false }).AND).not.toContainEqual({ profileLinks: { some: HANDLE_PROBLEM_WHERE } });
    expect(creatorWhere("org-1", f, { roster: true }).orgId).toBe("org-1");
  });
});
