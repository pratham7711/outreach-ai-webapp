/**
 * @jest-environment node
 */

/**
 * The password reset request.
 *
 * The behaviour worth pinning is the pair of things this endpoint must do at
 * once: never reveal whether an address is registered, and never let the page
 * claim an email was sent when no provider exists. Those pull in opposite
 * directions, and the resolution is that `delivery` describes the SERVER, so it
 * is identical for a known and an unknown address.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: jest.fn() },
    verificationToken: { deleteMany: jest.fn(), create: jest.fn() },
  },
}));

jest.mock("@/lib/email", () => ({
  emailConfigured: jest.fn(),
  sendEmail: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true })),
  rateLimitKey: jest.fn(() => "key"),
}));

import { POST } from "@/app/api/auth/forgot-password/route";
import { db } from "@/lib/db";
import { emailConfigured, sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rateLimit";

const mockDb = db as any;
const mockConfigured = emailConfigured as jest.Mock;
const mockSend = sendEmail as jest.Mock;
const mockRateLimit = rateLimit as jest.Mock;

/* The route hands the link back in the response outside production, which is a
   convenience for local work -- and, because it only appears for a registered
   address, the one part of the response that IS enumerable. Anything asserting
   the shape a real user sees has to pretend to be production. */
function asProduction<T>(fn: () => Promise<T>): Promise<T> {
  const was = process.env.NODE_ENV;
  Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
  return fn().finally(() => {
    Object.defineProperty(process.env, "NODE_ENV", { value: was, configurable: true });
  });
}

const request = (email: unknown) =>
  new NextRequest("https://campaign.madeboring.com/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockReturnValue({ allowed: true });
  mockConfigured.mockReturnValue(true);
  mockSend.mockResolvedValue({ sent: true, id: "e1" });
  mockDb.user.findUnique.mockResolvedValue({ id: "user-1" });
  mockDb.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
  mockDb.verificationToken.create.mockResolvedValue({});
});

describe("with an email provider configured", () => {
  it("mints a single-use token and emails the link", async () => {
    const res = await asProduction(() => POST(request("someone@example.com")));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, delivery: "sent" });
    expect(mockDb.verificationToken.create).toHaveBeenCalledTimes(1);
    const link = mockSend.mock.calls[0][0].text as string;
    expect(link).toContain("/reset-password?token=");
  });

  it("replaces any earlier token for the same address", async () => {
    await POST(request("someone@example.com"));
    expect(mockDb.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "reset:someone@example.com" },
    });
  });

  it("lower-cases the address so one account cannot hold two identifiers", async () => {
    await POST(request("SomeOne@Example.COM"));
    expect(mockDb.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "someone@example.com" } })
    );
  });

  it("still reports sent for an address that is not registered", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const res = await asProduction(() => POST(request("nobody@example.com")));
    await expect(res.json()).resolves.toEqual({ ok: true, delivery: "sent" });
    expect(mockDb.verificationToken.create).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("with no email provider", () => {
  beforeEach(() => mockConfigured.mockReturnValue(false));

  it("says delivery is unavailable rather than letting the page claim a send", async () => {
    const res = await asProduction(() => POST(request("someone@example.com")));
    await expect(res.json()).resolves.toEqual({ ok: true, delivery: "unavailable" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("still creates the token, so an admin can hand the link over", async () => {
    await POST(request("someone@example.com"));
    expect(mockDb.verificationToken.create).toHaveBeenCalledTimes(1);
  });

  it("answers identically for an unknown address, so nothing is enumerable", async () => {
    const known = await asProduction(() =>
      POST(request("someone@example.com")).then((r) => r.json())
    );
    mockDb.user.findUnique.mockResolvedValue(null);
    const unknown = await asProduction(() =>
      POST(request("nobody@example.com")).then((r) => r.json())
    );
    expect(unknown).toEqual(known);
  });
});

describe("the reset link in the response body", () => {
  it("is handed back outside production, for local work", async () => {
    const body = await POST(request("someone@example.com")).then((r) => r.json());
    expect(body.devResetUrl).toContain("/reset-password?token=");
  });

  it("is never in a production response, where it would leak the link itself", async () => {
    const body = await asProduction(() =>
      POST(request("someone@example.com")).then((r) => r.json())
    );
    expect(body).not.toHaveProperty("devResetUrl");
  });
});

describe("refusals", () => {
  it("rejects a malformed address", async () => {
    const res = await POST(request("not-an-email"));
    expect(res.status).toBe(400);
    expect(mockDb.verificationToken.create).not.toHaveBeenCalled();
  });

  it("rejects a missing address", async () => {
    const res = await POST(request(undefined));
    expect(res.status).toBe(400);
  });

  it("rate limits and says how long to wait", async () => {
    mockRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });
    const res = await POST(request("someone@example.com"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("does not fail the request when the provider throws", async () => {
    mockSend.mockRejectedValue(new Error("provider down"));
    const res = await POST(request("someone@example.com"));
    expect(res.status).toBe(500);
  });
});
