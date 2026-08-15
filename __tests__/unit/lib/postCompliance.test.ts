import { checkPostCompliance } from "@/lib/compliance/postCompliance";

const DEADLINE = "2026-01-10T00:00:00.000Z";

describe("checkPostCompliance", () => {
  it("returns no flags for a healthy on-time post", () => {
    const flags = checkPostCompliance(
      { postedAt: "2026-01-05T00:00:00.000Z", syncFailCount: 0, syncDisabledAt: null },
      { submissionDeadline: DEADLINE },
    );
    expect(flags).toEqual([]);
  });

  it("flags a post submitted after the deadline as an error", () => {
    const flags = checkPostCompliance(
      { postedAt: "2026-01-11T00:00:00.000Z", syncFailCount: 0, syncDisabledAt: null },
      { submissionDeadline: DEADLINE },
    );
    expect(flags.map((f) => f.code)).toContain("POSTED_AFTER_DEADLINE");
    expect(flags.find((f) => f.code === "POSTED_AFTER_DEADLINE")?.severity).toBe("error");
  });

  it("does not flag the deadline when the campaign has none", () => {
    const flags = checkPostCompliance(
      { postedAt: "2030-01-01T00:00:00.000Z", syncFailCount: 0, syncDisabledAt: null },
      { submissionDeadline: null },
    );
    expect(flags).toEqual([]);
  });

  it("flags a dead-lettered post (deleted/private) as an error", () => {
    const flags = checkPostCompliance(
      { postedAt: DEADLINE, syncFailCount: 5, syncDisabledAt: "2026-01-12T00:00:00.000Z" },
      { submissionDeadline: DEADLINE },
    );
    const codes = flags.map((f) => f.code);
    expect(codes).toContain("SYNC_DEAD_LETTERED");
    expect(codes).not.toContain("SYNC_FAILING");
  });

  it("flags a still-failing post as a warning (not yet dead-lettered)", () => {
    const flags = checkPostCompliance(
      { postedAt: DEADLINE, syncFailCount: 2, syncDisabledAt: null },
      { submissionDeadline: DEADLINE },
    );
    expect(flags.map((f) => f.code)).toEqual(["SYNC_FAILING"]);
  });
});
