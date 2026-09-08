/**
 * @jest-environment node
 *
 * Row-level campaign scope, applied to the routes that hang off a campaign.
 *
 * campaignScopeWhereFor was composed into GET /api/campaigns/[id] alone, so an
 * ASSIGNED-scoped seat that 404d on a campaign's detail page could still read
 * its performance, download its export, list its posts and mint a public share
 * link for it — the same campaign, four URLs away. These assert the scope
 * fragment reaches each query, and that OWNER/ADMIN and ALL-scoped seats are
 * left unnarrowed.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findMany: jest.fn() },
    report: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
// The export route pulls in @react-pdf/renderer, which ships ESM that this
// runner does not transform. Neither it nor the PDF document is under test here.
jest.mock("@react-pdf/renderer", () => ({ renderToBuffer: jest.fn() }));
jest.mock("@/lib/reports/CampaignPerformancePDF", () => ({ CampaignPerformancePDF: () => null }));
jest.mock("@/lib/reports/campaignPerformance", () => ({
  computeCampaignPerformance: jest.fn().mockResolvedValue({ kpis: {}, posts: [], leaderboard: [] }),
}));

import { GET as getPerformance } from "@/app/api/campaigns/[id]/performance/route";
import { GET as getExport } from "@/app/api/campaigns/[id]/export/route";
import { GET as getPosts, POST as postPost } from "@/app/api/campaigns/[id]/posts/route";
import {
  GET as getShare,
  POST as postShare,
  PATCH as patchShare,
  DELETE as deleteShare,
} from "@/app/api/campaigns/[id]/share/route";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;

const assignedSeat = {
  user: { id: "user-9", orgId: "org-1", role: "MEMBER", campaignScope: "ASSIGNED" },
};
const ownerSeat = { user: { id: "user-1", orgId: "org-1", role: "OWNER", campaignScope: "ASSIGNED" } };
const unscopedSeat = { user: { id: "user-2", orgId: "org-1", role: "MEMBER", campaignScope: "ALL" } };

/** What campaignScopeWhere produces for an ASSIGNED seat. */
const scopeFragment = {
  OR: [{ teamMembers: { some: { userId: "user-9" } } }, { createdById: "user-9" }],
};

const params = { params: Promise.resolve({ id: "camp-1" }) } as any;
const req = (init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest("http://localhost/api/campaigns/camp-1/x", init);
const jsonReq = (body: unknown) =>
  req({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(assignedSeat);
  // The campaign exists in the org but the scope fragment excludes it.
  mockDb.campaign.findFirst.mockResolvedValue(null);
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.report.findMany.mockResolvedValue([]);
  mockDb.report.findUnique.mockResolvedValue(null);
});

function lastWhere() {
  const calls = mockDb.campaign.findFirst.mock.calls;
  return calls[calls.length - 1][0].where;
}

describe("an ASSIGNED seat is scoped out of a campaign's satellite routes", () => {
  it("GET /performance 404s and asks for the scoped campaign", async () => {
    const res = await getPerformance(req(), params);
    expect(res.status).toBe(404);
    expect(lastWhere()).toMatchObject({ id: "camp-1", orgId: "org-1", deletedAt: null, ...scopeFragment });
  });

  it("GET /export 404s and asks for the scoped campaign", async () => {
    const res = await getExport(
      new NextRequest("http://localhost/api/campaigns/camp-1/export?format=csv"),
      params
    );
    expect(res.status).toBe(404);
    expect(lastWhere()).toMatchObject({ id: "camp-1", orgId: "org-1", deletedAt: null, ...scopeFragment });
  });

  it("GET /posts 404s and asks for the scoped campaign", async () => {
    const res = await getPosts(req(), params);
    expect(res.status).toBe(404);
    expect(lastWhere()).toMatchObject({ id: "camp-1", orgId: "org-1", deletedAt: null, ...scopeFragment });
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
  });

  it("POST /posts 404s before it writes", async () => {
    const res = await postPost(
      jsonReq({ postUrl: "https://www.tiktok.com/@a/video/1", creatorId: "c1" }),
      params
    );
    expect(res.status).toBe(404);
    expect(lastWhere()).toMatchObject(scopeFragment);
  });

  it("POST /share 404s rather than minting a public link", async () => {
    const res = await postShare(jsonReq({}), params);
    expect(res.status).toBe(404);
    expect(lastWhere()).toMatchObject(scopeFragment);
    expect(mockDb.report.create).not.toHaveBeenCalled();
  });

  it("GET, PATCH and DELETE /share are scoped too", async () => {
    expect((await getShare(req(), params)).status).toBe(404);
    expect(lastWhere()).toMatchObject(scopeFragment);
    expect((await patchShare(jsonReq({}), params)).status).toBe(404);
    expect(lastWhere()).toMatchObject(scopeFragment);
    expect((await deleteShare(req({ method: "DELETE" }), params)).status).toBe(404);
    expect(lastWhere()).toMatchObject(scopeFragment);
    expect(mockDb.report.update).not.toHaveBeenCalled();
  });
});

describe("seats that see everything are not narrowed", () => {
  it("an OWNER carrying campaignScope ASSIGNED still queries unscoped", async () => {
    mockAuth.mockResolvedValue(ownerSeat);
    await getPerformance(req(), params);
    expect(lastWhere()).toEqual({ id: "camp-1", orgId: "org-1", deletedAt: null });
  });

  it("an ALL-scoped MEMBER queries unscoped", async () => {
    mockAuth.mockResolvedValue(unscopedSeat);
    await getPosts(req(), params);
    expect(lastWhere()).toEqual({ id: "camp-1", orgId: "org-1", deletedAt: null });
  });

  it("an assigned seat that IS on the campaign gets served", async () => {
    mockDb.campaign.findFirst.mockResolvedValue({
      id: "camp-1",
      orgId: "org-1",
      budget: 1000,
      currency: "USD",
    });
    const res = await getPerformance(req(), params);
    expect(res.status).toBe(200);
  });
});
