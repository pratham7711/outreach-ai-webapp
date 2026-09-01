import {
  GRACE_DAYS,
  accessFor,
  canSignIn,
  isPlatformAdmin,
  suspensionCandidates,
  type OrgBillingState,
} from "@/lib/billing/subscription";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86400_000);

const org = (o: Partial<OrgBillingState> = {}): OrgBillingState => ({
  subscriptionStatus: "ACTIVE",
  paidThrough: daysFromNow(20),
  trialEndsAt: null,
  ...o,
});

describe("accessFor — who gets in", () => {
  it("lets an active agency straight through", () => {
    expect(accessFor(org(), NOW)).toMatchObject({ level: "full", reason: "ok" });
  });

  it("blocks a suspended agency, and says the data is intact", () => {
    const d = accessFor(org({ subscriptionStatus: "SUSPENDED" }), NOW);
    expect(d.level).toBe("blocked");
    expect(d.reason).toBe("suspended");
    // The wording matters: a locked-out client's first fear is that their work
    // is gone, and the message is the only thing they can see.
    expect(d.message).toMatch(/data is intact/i);
  });

  it("blocks a cancelled workspace", () => {
    expect(accessFor(org({ subscriptionStatus: "CANCELLED" }), NOW).level).toBe("blocked");
  });

  it("warns but does NOT block an overdue agency", () => {
    // The whole point of the grace period: payment is recorded by hand, so the
    // gap between paying and someone typing it in is a weekend at least.
    const d = accessFor(org({ subscriptionStatus: "PAST_DUE", paidThrough: daysFromNow(-2) }), NOW);
    expect(d.level).toBe("warned");
    expect(d.message).toMatch(/5 more days/);
  });

  it("still only warns on the last day of grace", () => {
    const d = accessFor(
      org({ subscriptionStatus: "PAST_DUE", paidThrough: daysFromNow(-GRACE_DAYS + 1) }),
      NOW
    );
    expect(d.level).toBe("warned");
  });

  it("keeps warning past the grace window rather than blocking by itself", () => {
    // Suspension is a decision, never a side effect of a date sliding past.
    const d = accessFor(
      org({ subscriptionStatus: "PAST_DUE", paidThrough: daysFromNow(-30) }),
      NOW
    );
    expect(d.level).toBe("warned");
    expect(d.message).toMatch(/may be suspended/i);
  });

  it("does not block an expired trial either", () => {
    const d = accessFor(
      org({ subscriptionStatus: "TRIALING", trialEndsAt: daysFromNow(-3) }),
      NOW
    );
    expect(d).toMatchObject({ level: "warned", reason: "trial_expired" });
  });

  it("lets a live trial through", () => {
    expect(
      accessFor(org({ subscriptionStatus: "TRIALING", trialEndsAt: daysFromNow(5) }), NOW).level
    ).toBe("full");
  });
});

describe("the way back in", () => {
  it("lets platform staff into a suspended workspace", () => {
    // Every user in this app belongs to an org. Without this, suspending an org
    // strands the only people who could unsuspend it.
    const d = accessFor(org({ subscriptionStatus: "SUSPENDED" }), NOW, { isPlatformAdmin: true });
    expect(d.level).toBe("full");
    expect(d.reason).toBe("platform_admin");
  });

  it("lets platform staff into a cancelled workspace too", () => {
    expect(
      accessFor(org({ subscriptionStatus: "CANCELLED" }), NOW, { isPlatformAdmin: true }).level
    ).toBe("full");
  });

  it("reads the allowlist from the environment, case- and space-insensitively", () => {
    const prev = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_ADMIN_EMAILS = " Owner@Example.com , ops@example.com ";
    expect(isPlatformAdmin("owner@example.com")).toBe(true);
    expect(isPlatformAdmin("OPS@EXAMPLE.COM")).toBe(true);
    expect(isPlatformAdmin("someone@else.com")).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    process.env.PLATFORM_ADMIN_EMAILS = prev;
  });

  it("treats an unset allowlist as nobody, not everybody", () => {
    const prev = process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(isPlatformAdmin("owner@example.com")).toBe(false);
    process.env.PLATFORM_ADMIN_EMAILS = prev;
  });
});

describe("canSignIn", () => {
  it.each([
    ["ACTIVE", true],
    ["TRIALING", true],
    ["PAST_DUE", true],
    ["SUSPENDED", false],
    ["CANCELLED", false],
  ] as const)("%s -> %s", (status, expected) => {
    expect(canSignIn(org({ subscriptionStatus: status }), NOW)).toBe(expected);
  });
});

describe("suspensionCandidates — suggests, never acts", () => {
  const mk = (id: string, status: OrgBillingState["subscriptionStatus"], paidDaysAgo: number) => ({
    id,
    ...org({ subscriptionStatus: status, paidThrough: daysFromNow(-paidDaysAgo) }),
  });

  it("surfaces only overdue agencies past the grace window", () => {
    const out = suspensionCandidates(
      [mk("a", "PAST_DUE", 30), mk("b", "PAST_DUE", 2), mk("c", "ACTIVE", 90)],
      NOW
    );
    expect(out.map((c) => c.org.id)).toEqual(["a"]);
    expect(out[0].daysOverdue).toBe(30);
  });

  it("puts the longest overdue first", () => {
    const out = suspensionCandidates([mk("a", "PAST_DUE", 10), mk("b", "PAST_DUE", 40)], NOW);
    expect(out.map((c) => c.org.id)).toEqual(["b", "a"]);
  });

  it("ignores an overdue agency that has never paid, having no period to measure", () => {
    const never = { id: "n", ...org({ subscriptionStatus: "PAST_DUE", paidThrough: null }) };
    expect(suspensionCandidates([never], NOW)).toEqual([]);
  });
});
