/**
 * @jest-environment node
 *
 * POST /api/auth/reset-password.
 *
 * Rows hold the sha256 of the emailed token (lib/passwordReset.ts), so the
 * lookup is by hash; and every unusable link -- malformed, unknown, expired --
 * gets one plain sentence instead of zod's wording or a hint at which it was.
 */
import { createHash } from "crypto";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    verificationToken: { findUnique: jest.fn(), deleteMany: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true })),
  rateLimitKey: jest.fn(() => "key"),
}));
jest.mock("bcryptjs", () => ({ __esModule: true, default: { hash: jest.fn(async () => "hashed") } }));

import { POST } from "@/app/api/auth/reset-password/route";
import { db } from "@/lib/db";
import { RESET_LINK_INVALID } from "@/lib/passwordReset";

const mdb = db as unknown as Record<string, any>;
const RAW = "a".repeat(64);
const HASH = createHash("sha256").update(RAW).digest("hex");

const submit = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  mdb.verificationToken.findUnique.mockResolvedValue({
    identifier: "reset:someone@example.com",
    token: HASH,
    expires: new Date(Date.now() + 30 * 60 * 1000),
  });
  mdb.user.findUnique.mockResolvedValue({ id: "user-1" });
  mdb.$transaction.mockResolvedValue([]);
});

describe("POST /api/auth/reset-password", () => {
  it("looks the token up by its hash and sets the password", async () => {
    const res = await submit({ token: RAW, password: "a-new-password" });
    expect(res.status).toBe(200);
    expect(mdb.verificationToken.findUnique).toHaveBeenCalledWith({ where: { token: HASH } });
    expect(mdb.$transaction).toHaveBeenCalledTimes(1);
  });

  /* A link minted before hashing shipped stored its raw token, which no hash
     matches: it reads as invalid and the person requests a new one. */
  it("does not accept a token that matches a stored value only as raw text", async () => {
    mdb.verificationToken.findUnique.mockImplementation(async ({ where }: any) =>
      where.token === RAW ? { identifier: "reset:someone@example.com", token: RAW, expires: new Date(Date.now() + 60_000) } : null
    );
    const res = await submit({ token: RAW, password: "a-new-password" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(RESET_LINK_INVALID);
    expect(mdb.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["too short", "abc"],
    ["missing", undefined],
    ["not a string", 12345],
  ])("answers a %s token with the plain invalid-link sentence", async (_label, token) => {
    const res = await submit({ token, password: "a-new-password" });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toBe("This reset link is invalid or has expired");
    expect(mdb.verificationToken.findUnique).not.toHaveBeenCalled();
  });

  it("gives the same sentence for an unknown and an expired link", async () => {
    mdb.verificationToken.findUnique.mockResolvedValue(null);
    const unknown = await (await submit({ token: RAW, password: "a-new-password" })).json();

    mdb.verificationToken.findUnique.mockResolvedValue({
      identifier: "reset:someone@example.com",
      token: HASH,
      expires: new Date(Date.now() - 1000),
    });
    const expired = await (await submit({ token: RAW, password: "a-new-password" })).json();

    expect(unknown).toEqual({ error: RESET_LINK_INVALID });
    expect(expired).toEqual(unknown);
    expect(mdb.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { token: HASH } });
  });

  it("refuses a verification-email row presented as a reset link", async () => {
    mdb.verificationToken.findUnique.mockResolvedValue({
      identifier: "verify:someone@example.com",
      token: HASH,
      expires: new Date(Date.now() + 60_000),
    });
    const res = await submit({ token: RAW, password: "a-new-password" });
    expect(res.status).toBe(400);
    expect(mdb.$transaction).not.toHaveBeenCalled();
  });

  it("still names a password problem as a password problem", async () => {
    const res = await submit({ token: RAW, password: "short" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Password must be at least 8 characters");
  });
});
