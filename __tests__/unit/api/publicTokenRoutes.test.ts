/**
 * @jest-environment node
 *
 * Two unauthenticated, token-keyed routes:
 *  - GET /api/kit/[token] returned the whole MediaKit row (orgId, createdById,
 *    free-form config) to anyone with the link; it now returns the kit's public
 *    content only.
 *  - POST /api/campaign-invites/respond had no rate limit; it now has the same
 *    one as the portal's invite accept.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    mediaKit: { findUnique: jest.fn() },
    campaignInvite: { findUnique: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true })),
  rateLimitKey: jest.fn(() => "key"),
}));

import { GET as KIT } from "@/app/api/kit/[token]/route";
import { POST as RESPOND } from "@/app/api/campaign-invites/respond/route";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const mockRateLimit = rateLimit as jest.Mock;

const kit = (token: string) =>
  KIT(new NextRequest(`http://localhost/api/kit/${token}`), { params: Promise.resolve({ token }) });

const respond = (body: unknown) =>
  RESPOND(
    new NextRequest("http://localhost/api/campaign-invites/respond", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockReturnValue({ allowed: true });
});

describe("GET /api/kit/[token]", () => {
  it("asks the database for the public fields only", async () => {
    mdb.mediaKit.findUnique.mockResolvedValue({
      title: "Autumn roster",
      slug: "autumn-roster",
      creatorIds: ["c1"],
      createdAt: new Date("2026-10-01T00:00:00Z"),
      isPublic: true,
    });
    const res = await kit("tok-1");
    expect(res.status).toBe(200);
    const { select, where } = mdb.mediaKit.findUnique.mock.calls[0][0];
    expect(where).toEqual({ shareToken: "tok-1" });
    for (const internal of ["orgId", "config", "createdById", "id", "shareToken"]) {
      expect(select).not.toHaveProperty(internal);
    }
    expect(await res.json()).toEqual({
      title: "Autumn roster",
      slug: "autumn-roster",
      creatorIds: ["c1"],
      createdAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("still refuses a kit that is not shared", async () => {
    mdb.mediaKit.findUnique.mockResolvedValue({ title: "x", slug: "x", creatorIds: [], createdAt: new Date(), isPublic: false });
    expect((await kit("tok-1")).status).toBe(403);
  });

  it("404s an unknown token", async () => {
    mdb.mediaKit.findUnique.mockResolvedValue(null);
    expect((await kit("nope")).status).toBe(404);
  });
});

describe("POST /api/campaign-invites/respond", () => {
  it("is rate limited before it looks the token up", async () => {
    mockRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 99 });
    const res = await respond({ token: "t", action: "DECLINED" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("99");
    expect(mdb.campaignInvite.findUnique).not.toHaveBeenCalled();
  });

  it("answers normally inside the allowance", async () => {
    mdb.campaignInvite.findUnique.mockResolvedValue({ id: "i1", status: "PENDING" });
    mdb.campaignInvite.update.mockResolvedValue({ id: "i1", status: "DECLINED" });
    const res = await respond({ token: "t", action: "DECLINED" });
    expect(res.status).toBe(200);
    expect(mockRateLimit.mock.calls[0][0]).toMatchObject({ limit: 20, windowMs: 60 * 60 * 1000 });
  });
});
