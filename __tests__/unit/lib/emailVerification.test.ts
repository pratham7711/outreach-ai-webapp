/**
 * lib/emailVerification — the identifier namespace that keeps signup
 * confirmation and password reset from spending each other's tokens, and the
 * enforcement predicate that decides whether an unverified sign-in is refused.
 */

const mockTokenDeleteMany = jest.fn();
const mockTokenCreate = jest.fn();
const mockTokenFindUnique = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    verificationToken: {
      deleteMany: (...a: any[]) => mockTokenDeleteMany(...a),
      create: (...a: any[]) => mockTokenCreate(...a),
      findUnique: (...a: any[]) => mockTokenFindUnique(...a),
    },
    user: {
      findUnique: (...a: any[]) => mockUserFindUnique(...a),
      update: (...a: any[]) => mockUserUpdate(...a),
    },
  },
}));

const mockSendEmail = jest.fn();
const mockEmailConfigured = jest.fn();
jest.mock("@/lib/email", () => ({
  sendEmail: (...a: any[]) => mockSendEmail(...a),
  emailConfigured: () => mockEmailConfigured(),
}));

import {
  VERIFY_ENFORCED_FROM,
  emailFromVerifyIdentifier,
  issueEmailVerification,
  loginBlockedForUnverified,
  verifyEmailToken,
  verifyIdentifier,
  verifyUrl,
} from "@/lib/emailVerification";

const OLD_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV };
  mockEmailConfigured.mockReturnValue(true);
  mockSendEmail.mockResolvedValue({ sent: true, id: "e1" });
  mockTokenDeleteMany.mockResolvedValue({ count: 0 });
  mockTokenCreate.mockResolvedValue({});
});

afterAll(() => {
  process.env = OLD_ENV;
});

describe("identifier namespace", () => {
  it("lowercases the address so a capitalised login still finds its token", () => {
    expect(verifyIdentifier("Person@Example.com")).toBe("verify:person@example.com");
  });

  it("reads its own identifiers back", () => {
    expect(emailFromVerifyIdentifier("verify:a@b.com")).toBe("a@b.com");
  });

  /* The whole reason the prefix exists. A confirmation link is mailed to an
     address we have NOT yet proven belongs to the account, so if this returned
     an address for a "reset:" row, that link would double as a working
     password-reset token for somebody else's account. */
  it("refuses a password-reset row outright", () => {
    expect(emailFromVerifyIdentifier("reset:a@b.com")).toBeNull();
  });

  it("refuses a prefix with no address behind it", () => {
    expect(emailFromVerifyIdentifier("verify:")).toBeNull();
  });

  it("builds a link that survives an address with a plus in it", () => {
    expect(verifyUrl("https://x.test/", "a+b")).toBe("https://x.test/verify-email?token=a%2Bb");
  });
});

describe("verifyEmailToken", () => {
  const future = new Date(Date.now() + 60_000);

  it("marks a first-time confirmation and consumes every token for the address", async () => {
    mockTokenFindUnique.mockResolvedValue({ identifier: "verify:a@b.com", expires: future });
    mockUserFindUnique.mockResolvedValue({ id: "u1", orgId: "o1", emailVerified: null });

    const out = await verifyEmailToken("t".repeat(64));

    expect(out).toEqual({
      ok: true,
      userId: "u1",
      orgId: "o1",
      email: "a@b.com",
      alreadyVerified: false,
    });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } })
    );
    expect(mockTokenDeleteMany).toHaveBeenCalledWith({ where: { identifier: "verify:a@b.com" } });
  });

  /* A mail client that prefetches the link must not make the real click look
     broken, so the second visit reports success rather than "not valid". */
  it("reports success without rewriting the date on a second visit", async () => {
    mockTokenFindUnique.mockResolvedValue({ identifier: "verify:a@b.com", expires: future });
    mockUserFindUnique.mockResolvedValue({ id: "u1", orgId: "o1", emailVerified: new Date() });

    const out = await verifyEmailToken("t".repeat(64));

    expect(out).toMatchObject({ ok: true, alreadyVerified: true });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("will not spend a password-reset token", async () => {
    mockTokenFindUnique.mockResolvedValue({ identifier: "reset:a@b.com", expires: future });

    expect(await verifyEmailToken("t".repeat(64))).toEqual({ ok: false, reason: "invalid" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("clears an expired link instead of leaving it to be retried", async () => {
    mockTokenFindUnique.mockResolvedValue({
      identifier: "verify:a@b.com",
      expires: new Date(Date.now() - 1),
    });

    expect(await verifyEmailToken("t".repeat(64))).toEqual({ ok: false, reason: "expired" });
    expect(mockTokenDeleteMany).toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("treats an unknown token as invalid", async () => {
    mockTokenFindUnique.mockResolvedValue(null);
    expect(await verifyEmailToken("t".repeat(64))).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("issueEmailVerification", () => {
  it("replaces any live link before minting a new one", async () => {
    await issueEmailVerification({ email: "A@b.com", origin: "https://x.test" });

    expect(mockTokenDeleteMany).toHaveBeenCalledWith({
      where: { identifier: "verify:a@b.com" },
    });
    const order = mockTokenDeleteMany.mock.invocationCallOrder[0];
    expect(mockTokenCreate.mock.invocationCallOrder[0]).toBeGreaterThan(order);
  });

  it("files the mail under its own kind so delivery is auditable", async () => {
    await issueEmailVerification({ email: "a@b.com", origin: "https://x.test", orgId: "o1" });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "email_verification", to: "a@b.com", orgId: "o1" })
    );
  });

  /* Signup has already created the account by the time this runs. A throw here
     would surface as a 500 on a successful signup, and the user's retry would
     be told the email is taken -- an account they can neither verify nor
     recreate. */
  it("reports failure rather than throwing when the token cannot be stored", async () => {
    mockTokenCreate.mockRejectedValue(new Error("db down"));
    const out = await issueEmailVerification({ email: "a@b.com", origin: "https://x.test" });
    expect(out.sent).toBe(false);
    expect(out.url).toContain("/verify-email?token=");
  });

  it("still returns the link when no provider is configured, so it stays recoverable", async () => {
    mockEmailConfigured.mockReturnValue(false);
    const out = await issueEmailVerification({ email: "a@b.com", origin: "https://x.test" });
    expect(out.sent).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(out.url).toContain("/verify-email?token=");
  });
});

describe("loginBlockedForUnverified", () => {
  const after = new Date(VERIFY_ENFORCED_FROM.getTime() + 1000);
  const before = new Date(VERIFY_ENFORCED_FROM.getTime() - 1000);

  it("is off unless the deployment asks for it", () => {
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    expect(loginBlockedForUnverified({ emailVerified: null, createdAt: after })).toBe(false);
  });

  it("blocks an unverified account created once the mail was being sent", () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = "1";
    expect(loginBlockedForUnverified({ emailVerified: null, createdAt: after })).toBe(true);
  });

  /* The reason enforcement is safe to switch on at all. Every account predating
     the feature has emailVerified null and was never sent a link, so gating on
     the null alone would lock out the entire existing user base -- including
     the owner, whose only route back in is behind this same login. */
  it("never blocks an account that predates the confirmation mail", () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = "1";
    expect(loginBlockedForUnverified({ emailVerified: null, createdAt: before })).toBe(false);
  });

  it("never blocks a confirmed account", () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = "1";
    expect(
      loginBlockedForUnverified({ emailVerified: new Date(), createdAt: after })
    ).toBe(false);
  });
});
