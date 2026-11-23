/**
 * @jest-environment node
 *
 * A creator portal account opens only from the link mailed to its address,
 * and that link is a separate kind of token from the agency's own email
 * confirmation and password reset.
 */
jest.mock("@/lib/db", () => ({
  db: {
    verificationToken: { findFirst: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
    creatorUser: { findUnique: jest.fn(), deleteMany: jest.fn() },
    creatorEmailVerification: { findUnique: jest.fn(), create: jest.fn() },
  },
}));
jest.mock("@/lib/email", () => ({ emailConfigured: jest.fn(() => false), sendEmail: jest.fn() }));

import { db } from "@/lib/db";
import { sendEmail, emailConfigured } from "@/lib/email";
import { emailFromVerifyIdentifier } from "@/lib/emailVerification";
import {
  CREATOR_VERIFY_FROM,
  clearAbandonedSignup,
  creatorEmailState,
  creatorVerifyIdentifier,
  creatorVerifyUrl,
  issueCreatorVerification,
  verifyCreatorEmailToken,
} from "@/lib/portal/creatorEmailVerification";

const m = db as unknown as {
  verificationToken: Record<"findFirst" | "findUnique" | "deleteMany" | "create", jest.Mock>;
  creatorUser: Record<"findUnique" | "deleteMany", jest.Mock>;
  creatorEmailVerification: Record<"findUnique" | "create", jest.Mock>;
};

beforeEach(() => {
  jest.resetAllMocks();
  (emailConfigured as jest.Mock).mockReturnValue(false);
  m.verificationToken.findFirst.mockResolvedValue(null);
  m.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
  m.verificationToken.create.mockResolvedValue({});
});

describe("token kinds", () => {
  it("is never readable as the agency's own confirmation token", () => {
    expect(emailFromVerifyIdentifier(creatorVerifyIdentifier("a@b.co"))).toBeNull();
  });

  it("refuses an agency confirmation or password-reset token", async () => {
    for (const identifier of ["verify:a@b.co", "reset:a@b.co"]) {
      m.verificationToken.findUnique.mockResolvedValueOnce({ identifier, token: "t", expires: new Date(Date.now() + 1e6) });
      await expect(verifyCreatorEmailToken("t")).resolves.toEqual({ ok: false, reason: "invalid" });
    }
    expect(m.creatorEmailVerification.create).not.toHaveBeenCalled();
  });
});

describe("issueCreatorVerification", () => {
  it("carries the errand on the link", () => {
    expect(creatorVerifyUrl("https://x.test/", "tok", "?agency=abc")).toBe("https://x.test/portal/verify-email?token=tok&agency=abc");
    expect(creatorVerifyUrl("https://x.test", "tok", "")).toBe("https://x.test/portal/verify-email?token=tok");
  });

  it("mints a 24-hour link and, with no mail provider, hands it back instead of sending", async () => {
    const r = await issueCreatorVerification({ email: "Maya@Example.com", origin: "https://x.test", errandQuery: "?agency=abc" });
    expect(r.sent).toBe(false);
    expect(r.url).toMatch(/^https:\/\/x\.test\/portal\/verify-email\?token=[0-9a-f]{64}&agency=abc$/);
    const data = m.verificationToken.create.mock.calls[0][0].data;
    expect(data.identifier).toBe("creator-verify:maya@example.com");
    expect(data.expires.getTime() - Date.now()).toBeGreaterThan(23 * 3600e3);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not mint a second link within a minute of the first", async () => {
    m.verificationToken.findFirst.mockResolvedValue({ expires: new Date(Date.now() + 24 * 3600e3 - 10e3) });
    await expect(issueCreatorVerification({ email: "a@b.co", origin: "https://x.test" })).resolves.toEqual({ url: null, sent: true, reused: true });
    expect(m.verificationToken.create).not.toHaveBeenCalled();
  });

  it("mails the link when a provider is configured", async () => {
    (emailConfigured as jest.Mock).mockReturnValue(true);
    (sendEmail as jest.Mock).mockResolvedValue({ sent: true, id: "e1" });
    const r = await issueCreatorVerification({ email: "a@b.co", origin: "https://x.test" });
    expect(r.sent).toBe(true);
    expect((sendEmail as jest.Mock).mock.calls[0][0]).toMatchObject({ to: "a@b.co", kind: "email_verification" });
  });
});

describe("verifyCreatorEmailToken", () => {
  const live = { identifier: "creator-verify:a@b.co", token: "t", expires: new Date(Date.now() + 1e6) };

  it("confirms the address and spends every link for it", async () => {
    m.verificationToken.findUnique.mockResolvedValue(live);
    m.creatorUser.findUnique.mockResolvedValue({ id: "cu1", email: "a@b.co" });
    m.creatorEmailVerification.findUnique.mockResolvedValue(null);
    await expect(verifyCreatorEmailToken("t")).resolves.toEqual({ ok: true, creatorUserId: "cu1", email: "a@b.co", alreadyVerified: false });
    expect(m.creatorEmailVerification.create).toHaveBeenCalledWith({ data: { creatorUserId: "cu1" } });
    expect(m.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { identifier: live.identifier } });
  });

  it("refuses an expired link and removes it", async () => {
    m.verificationToken.findUnique.mockResolvedValue({ ...live, expires: new Date(Date.now() - 1) });
    await expect(verifyCreatorEmailToken("t")).resolves.toEqual({ ok: false, reason: "expired" });
    expect(m.creatorEmailVerification.create).not.toHaveBeenCalled();
  });
});

describe("creatorEmailState", () => {
  it("reads verified, unverified, and unavailable while the table is missing", async () => {
    m.creatorEmailVerification.findUnique.mockResolvedValueOnce({ creatorUserId: "cu1" });
    await expect(creatorEmailState("cu1")).resolves.toBe("verified");
    m.creatorEmailVerification.findUnique.mockResolvedValueOnce(null);
    await expect(creatorEmailState("cu1")).resolves.toBe("unverified");
    m.creatorEmailVerification.findUnique.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "P2021" }));
    await expect(creatorEmailState("cu1")).resolves.toBe("unavailable");
  });
});

describe("clearAbandonedSignup", () => {
  it("only frees unconfirmed confirmation-era sign-ups older than a day that hold nothing", async () => {
    m.creatorUser.deleteMany.mockResolvedValue({ count: 1 });
    await clearAbandonedSignup({ email: "a@b.co" });
    const where = m.creatorUser.deleteMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      email: "a@b.co",
      emailVerification: { is: null },
      sessions: { none: {} },
      rosterRows: { none: {} },
      socialAccounts: { none: {} },
    });
    expect(where.createdAt.gte).toBe(CREATOR_VERIFY_FROM);
    expect(Date.now() - where.createdAt.lt.getTime()).toBeGreaterThanOrEqual(24 * 3600e3 - 1000);
  });
});
