import {
  campaignScopeWhere,
  scopeSubjectFromSession,
  seesAllCampaigns,
  type ScopeSubject,
} from "@/lib/campaignScope";

const subject = (o: Partial<ScopeSubject> = {}): ScopeSubject => ({
  userId: "u1",
  role: "MEMBER",
  campaignScope: "ALL",
  ...o,
});

describe("seesAllCampaigns", () => {
  it("is true for anyone not scoped down", () => {
    expect(seesAllCampaigns(subject())).toBe(true);
  });

  it("is false for a scoped member", () => {
    expect(seesAllCampaigns(subject({ campaignScope: "ASSIGNED" }))).toBe(false);
  });

  it.each(["OWNER", "ADMIN"])(
    "keeps %s on the full view even when scoped down",
    (role) => {
      // Scoping an admin out would lock them out of campaigns they are
      // accountable for, and out of the screen where scope is administered.
      expect(seesAllCampaigns(subject({ role, campaignScope: "ASSIGNED" }))).toBe(true);
    }
  );

  it("does scope a MANAGER, who is not an admin", () => {
    expect(seesAllCampaigns(subject({ role: "MANAGER", campaignScope: "ASSIGNED" }))).toBe(false);
  });
});

describe("campaignScopeWhere", () => {
  it("adds nothing for an unscoped user, so callers can spread it blindly", () => {
    expect(campaignScopeWhere(subject())).toEqual({});
  });

  it("limits a scoped user to their team memberships and their own campaigns", () => {
    expect(campaignScopeWhere(subject({ campaignScope: "ASSIGNED" }))).toEqual({
      OR: [
        { teamMembers: { some: { userId: "u1" } } },
        { createdById: "u1" },
      ],
    });
  });

  it("includes campaigns the user created", () => {
    // Otherwise someone creates a campaign and it vanishes, which reads as data
    // loss rather than as a permission boundary.
    const where = campaignScopeWhere(subject({ campaignScope: "ASSIGNED" })) as {
      OR: Record<string, unknown>[];
    };
    expect(where.OR).toContainEqual({ createdById: "u1" });
  });

  it("adds nothing for a scoped OWNER", () => {
    expect(campaignScopeWhere(subject({ role: "OWNER", campaignScope: "ASSIGNED" }))).toEqual({});
  });
});

describe("scopeSubjectFromSession", () => {
  it("reads a well-formed session user", () => {
    expect(
      scopeSubjectFromSession({ id: "u9", role: "MANAGER", campaignScope: "ASSIGNED" })
    ).toEqual({ userId: "u9", role: "MANAGER", campaignScope: "ASSIGNED" });
  });

  it("returns null without a user id, rather than inventing a subject", () => {
    expect(scopeSubjectFromSession(null)).toBeNull();
    expect(scopeSubjectFromSession({ role: "MEMBER" })).toBeNull();
  });

  it("falls back to ALL on an unreadable scope, not ASSIGNED", () => {
    // Failing closed here would hide a user's own work from them over a typo in
    // a column, which looks like the product losing their data.
    expect(scopeSubjectFromSession({ id: "u1", role: "MEMBER" })!.campaignScope).toBe("ALL");
    expect(
      scopeSubjectFromSession({ id: "u1", role: "MEMBER", campaignScope: "nonsense" })!
        .campaignScope
    ).toBe("ALL");
  });

  it("defaults an unreadable role to the least privileged", () => {
    expect(scopeSubjectFromSession({ id: "u1" })!.role).toBe("VIEWER");
  });
});
