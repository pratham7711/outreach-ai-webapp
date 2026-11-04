/**
 * @jest-environment node
 *
 * POST /api/signup schedules exactly one operator notice for a created
 * workspace, after the response, and none for a refused signup.
 */
jest.mock("@/lib/observability/requestLogger", () => ({
  requestLogger: () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }),
}));
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ allowed: true }),
  rateLimitKey: () => "k",
  configuredLimit: (_v: unknown, d: number) => d,
}));
jest.mock("bcryptjs", () => ({ hash: async () => "hashed" }));
jest.mock("@/lib/emailVerification", () => ({
  issueEmailVerification: jest.fn(async () => ({ sent: true, url: "http://x/verify" })),
  appOrigin: (fallback: string) => fallback,
}));
const mockNotify = jest.fn(async () => {});
jest.mock("@/lib/ops/signupNotice", () => ({ notifyNewSignup: (...a: unknown[]) => mockNotify(...(a as [])) }));
const mockAfter = jest.fn();
jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: (fn: () => unknown) => mockAfter(fn) }));

const existingUser = jest.fn(async (): Promise<{ id: string } | null> => null);
jest.mock("@/lib/db", () => {
  const tx = {
    organization: { create: async () => ({ id: "org-new" }) },
    user: { create: async () => ({ id: "user-new", orgId: "org-new" }) },
    orgPlanConfig: { create: async () => ({}) },
  };
  return {
    db: {
      user: { findUnique: () => existingUser() },
      organization: { findUnique: async () => null },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/signup/route";

const body = { orgName: "Harbour Media", name: "Asha Rao", email: "Asha@Harbour.example", password: "longenough", orgType: "BRAND" };
const req = (b: unknown) => new NextRequest("http://localhost/api/signup", { method: "POST", body: JSON.stringify(b) });

beforeEach(() => jest.clearAllMocks());

it("schedules one notice after a workspace is created", async () => {
  const res = await POST(req(body));
  expect(res.status).toBe(201);
  expect(mockAfter).toHaveBeenCalledTimes(1);
  expect(mockNotify).not.toHaveBeenCalled();

  await mockAfter.mock.calls[0][0]();
  expect(mockNotify).toHaveBeenCalledTimes(1);
  expect(mockNotify).toHaveBeenCalledWith({
    orgId: "org-new",
    userId: "user-new",
    orgName: "Harbour Media",
    orgType: "BRAND",
    plan: "free",
    ownerName: "Asha Rao",
    ownerEmail: "asha@harbour.example",
    verificationSent: true,
    origin: "http://localhost",
  });
});

it("schedules nothing when the email is already taken", async () => {
  existingUser.mockResolvedValueOnce({ id: "someone" });
  const res = await POST(req(body));
  expect(res.status).toBe(409);
  expect(mockAfter).not.toHaveBeenCalled();
});

it("schedules nothing for invalid input", async () => {
  const res = await POST(req({ ...body, password: "short" }));
  expect(res.status).toBe(400);
  expect(mockAfter).not.toHaveBeenCalled();
});
