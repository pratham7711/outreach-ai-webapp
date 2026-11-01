/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({
  getOrgEntitlements: jest.fn(),
  hasOrgFeature: (e: { featureMap: Record<string, boolean> } | null, key: string) => e?.featureMap[key] === true,
}));
jest.mock("@/lib/db", () => ({
  db: {
    creatorProspect: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), createManyAndReturn: jest.fn() },
    creatorProspectEvent: { createMany: jest.fn() },
    creator: { findMany: jest.fn().mockResolvedValue([]) },
    creatorProfileLink: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

import { authenticateRequest } from "@/lib/authenticate";
import { getOrgEntitlements } from "@/lib/entitlements";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/creator-finder/route";
import { GET as SEARCH } from "@/app/api/creator-finder/youtube-search/route";
import { GET as PROFILE } from "@/app/api/creator-finder/[id]/profile/route";
import { resolveDashboardPolicy } from "@/lib/dashboardPolicy";

const auth = authenticateRequest as jest.Mock;
const ents = getOrgEntitlements as jest.Mock;
const mdb = db as unknown as {
  creatorProspect: { findMany: jest.Mock; findFirst: jest.Mock; createManyAndReturn: jest.Mock };
  creatorProspectEvent: { createMany: jest.Mock };
};

const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init as never);
const ctx = { params: Promise.resolve({ id: "p1" }) };

beforeEach(() => {
  jest.clearAllMocks();
  auth.mockResolvedValue({ orgId: "org-a", userId: "u1", role: "OWNER", actorType: "user", actorEmail: null, campaignScope: "ALL" });
});

describe("Creator Finder is off unless the org has creator_finder", () => {
  beforeEach(() => ents.mockResolvedValue({ featureMap: {} }));

  it("refuses every route with 403 and reads nothing", async () => {
    for (const res of [
      await GET(req("/api/creator-finder")),
      await POST(req("/api/creator-finder", { method: "POST", body: JSON.stringify({ text: "@a" }) })),
      await SEARCH(req("/api/creator-finder/youtube-search?q=phonk")),
      await PROFILE(req("/api/creator-finder/p1/profile"), ctx),
    ]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("feature_disabled");
    }
    expect(mdb.creatorProspect.findMany).not.toHaveBeenCalled();
    expect(mdb.creatorProspect.findFirst).not.toHaveBeenCalled();
  });

  it("needs a signed-in user before anything else", async () => {
    auth.mockResolvedValue(null);
    expect((await GET(req("/api/creator-finder"))).status).toBe(401);
    expect(ents).not.toHaveBeenCalled();
  });

  it("keeps the sidebar link hidden, even for an org with no nav customisation", () => {
    const policy = resolveDashboardPolicy({ entitlements: { featureMap: {}, branding: {} } as never, uiConfig: null });
    expect(policy.allowedNavHrefs).not.toContain("/creator-finder");
  });
});

describe("with creator_finder on", () => {
  beforeEach(() => ents.mockResolvedValue({ featureMap: { creator_finder: true } }));

  it("lists only this org's cards", async () => {
    const res = await GET(req("/api/creator-finder"));
    expect(res.status).toBe(200);
    expect(mdb.creatorProspect.findMany.mock.calls[0][0].where).toEqual({ orgId: "org-a" });
  });

  it("adds new handles to Found under this org, with an event each", async () => {
    mdb.creatorProspect.findMany.mockResolvedValueOnce([]);
    mdb.creatorProspect.createManyAndReturn.mockResolvedValue([{ id: "n1" }]);
    const res = await POST(req("/api/creator-finder", { method: "POST", body: JSON.stringify({ text: "@new_one" }) }));
    const body = await res.json();
    expect(body.added).toBe(1);
    const data = mdb.creatorProspect.createManyAndReturn.mock.calls[0][0].data;
    expect(data).toEqual([expect.objectContaining({ orgId: "org-a", platform: "INSTAGRAM", handle: "new_one", source: "PASTE" })]);
    expect(mdb.creatorProspectEvent.createMany.mock.calls[0][0].data).toEqual([
      { prospectId: "n1", orgId: "org-a", fromStatus: null, toStatus: "FOUND", userId: "u1" },
    ]);
  });

  it("shows the sidebar link even to an org whose nav was customised before it shipped", () => {
    const policy = resolveDashboardPolicy({
      entitlements: { featureMap: { creator_finder: true }, branding: {} } as never,
      uiConfig: { nav: ["campaigns"] } as never,
    });
    expect(policy.allowedNavHrefs).toContain("/creator-finder");
  });
});
