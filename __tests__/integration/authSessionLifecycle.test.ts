/**
 * @jest-environment node
 *
 * What a removal or a demotion actually does to a live session.
 *
 * The JWT copied role and orgId in once, at sign-in, and nothing ever looked at
 * them again — so demoting an ADMIN to VIEWER changed nothing until they
 * happened to log out, and `User.isActive` was written by nobody and read by
 * nobody, so a "removed" teammate could sign straight back in.
 *
 * NextAuth is stubbed so the config object it is handed can be exercised
 * directly: `authorize` and the `jwt` callback are ordinary functions.
 */
/* jest.mock factories are hoisted above every import, and `import "@/lib/auth"`
   below is itself hoisted — so the factory runs before any const in this file
   is initialised. It therefore parks the config on globalThis rather than
   closing over a local, and builds its own error class inline. */
jest.mock("next-auth", () => ({
  __esModule: true,
  default: (config: any) => {
    (globalThis as any).__capturedAuthConfig = config;
    return { handlers: {}, auth: jest.fn(), signIn: jest.fn(), signOut: jest.fn() };
  },
  CredentialsSignin: class FakeCredentialsSignin extends Error {},
}));
jest.mock("next-auth/providers/credentials", () => ({
  __esModule: true,
  default: (options: any) => options,
}));
jest.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
jest.mock("bcryptjs", () => ({ __esModule: true, default: { compare: jest.fn(), hash: jest.fn() } }));
jest.mock("@/lib/db", () => ({
  db: { user: { findUnique: jest.fn(), update: jest.fn() } },
}));
jest.mock("@/lib/emailVerification", () => ({ loginBlockedForUnverified: jest.fn(() => false) }));
jest.mock("@/lib/billing/subscription", () => ({
  accessFor: jest.fn(() => ({ level: "full", message: "" })),
  isPlatformAdmin: jest.fn(() => false),
}));

import "@/lib/auth";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

const mockDb = db as any;
const mockCompare = (bcrypt as any).compare as jest.Mock;

const config = () => (globalThis as any).__capturedAuthConfig;
const authorize = () => config().providers[0].authorize;
const jwt = () => config().callbacks.jwt;

const dbUser = (over: Record<string, unknown> = {}) => ({
  id: "u-1",
  email: "ada@acme.test",
  name: "Ada",
  password: "hashed",
  orgId: "org-1",
  role: "ADMIN",
  campaignScope: "ALL",
  isActive: true,
  org: { subscriptionStatus: "active", paidThrough: null, trialEndsAt: null, suspendedReason: null },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCompare.mockResolvedValue(true);
  mockDb.user.update.mockResolvedValue({});
});

// ─── Signing in ──────────────────────────────────────────────────────────────

describe("credentials login", () => {
  const creds = { email: "ada@acme.test", password: "correct horse" };

  it("refuses a deactivated account even with the right password", async () => {
    mockDb.user.findUnique.mockResolvedValue(dbUser({ isActive: false }));
    await expect(authorize()(creds, undefined)).rejects.toThrow(/deactivated/i);
  });

  it("lets an active account through", async () => {
    mockDb.user.findUnique.mockResolvedValue(dbUser());
    const user = await authorize()(creds, undefined);
    expect(user).toMatchObject({ id: "u-1", orgId: "org-1", role: "ADMIN" });
  });

  /* The Team screen has rendered a Last Login column since it existed, and the
     column has always said "Never" because nothing wrote the field. */
  it("stamps lastLoginAt and the request IP", async () => {
    mockDb.user.findUnique.mockResolvedValue(dbUser());
    const request = { headers: new Headers({ "x-real-ip": "203.0.113.9" }) };
    await authorize()(creds, request);
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: "u-1" },
      data: { lastLoginAt: expect.any(Date), lastLoginIp: "203.0.113.9" },
    });
  });

  it("does not block the login when that write fails", async () => {
    mockDb.user.findUnique.mockResolvedValue(dbUser());
    mockDb.user.update.mockRejectedValue(new Error("ECONNRESET"));
    const user = await authorize()(creds, { headers: new Headers() });
    expect(user).toMatchObject({ id: "u-1" });
  });

  it("writes no IP when the request carries no forwarding header", async () => {
    mockDb.user.findUnique.mockResolvedValue(dbUser());
    await authorize()(creds, { headers: new Headers() });
    expect(mockDb.user.update.mock.calls[0][0].data.lastLoginIp).toBeNull();
  });

  it("stamps nothing on a refused login", async () => {
    mockDb.user.findUnique.mockResolvedValue(dbUser());
    mockCompare.mockResolvedValue(false);
    await authorize()(creds, { headers: new Headers() });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("still refuses a wrong password before it ever looks at isActive", async () => {
    mockDb.user.findUnique.mockResolvedValue(dbUser({ isActive: false }));
    mockCompare.mockResolvedValue(false);
    await expect(authorize()(creds, undefined)).resolves.toBeNull();
  });
});

// ─── Keeping a live session honest ───────────────────────────────────────────

describe("the jwt callback", () => {
  it("copies the sign-in values in on the first pass and does not query", async () => {
    const token = await jwt()({
      token: {},
      user: { id: "u-1", orgId: "org-1", role: "ADMIN", campaignScope: "ALL" },
    });
    expect(token).toMatchObject({ id: "u-1", orgId: "org-1", role: "ADMIN" });
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
  });

  it("picks up a demotion on the next refresh", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      role: "VIEWER",
      isActive: true,
      campaignScope: "ASSIGNED",
      orgId: "org-1",
    });
    const token = await jwt()({
      token: { id: "u-1", orgId: "org-1", role: "ADMIN", checkedAt: 0 },
      user: undefined,
    });
    expect(token).toMatchObject({ role: "VIEWER", campaignScope: "ASSIGNED" });
  });

  it("destroys the session of a deactivated user", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      role: "ADMIN",
      isActive: false,
      campaignScope: "ALL",
      orgId: "org-1",
    });
    const token = await jwt()({
      token: { id: "u-1", orgId: "org-1", role: "ADMIN", checkedAt: 0 },
      user: undefined,
    });
    expect(token).toBeNull();
  });

  it("destroys the session of a user row that has gone", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const token = await jwt()({
      token: { id: "u-1", role: "ADMIN", checkedAt: 0 },
      user: undefined,
    });
    expect(token).toBeNull();
  });

  it("does not re-query within the refresh interval", async () => {
    const token = await jwt()({
      token: { id: "u-1", orgId: "org-1", role: "ADMIN", checkedAt: Date.now() },
      user: undefined,
    });
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(token).toMatchObject({ role: "ADMIN" });
  });

  /* Signing the whole workspace out over a dropped connection is worse than a
     role staying stale for another minute. */
  it("keeps the existing token when the database is unreachable", async () => {
    mockDb.user.findUnique.mockRejectedValue(new Error("ECONNRESET"));
    const token = await jwt()({
      token: { id: "u-1", orgId: "org-1", role: "ADMIN", checkedAt: 0 },
      user: undefined,
    });
    expect(token).toMatchObject({ role: "ADMIN" });
  });
});
