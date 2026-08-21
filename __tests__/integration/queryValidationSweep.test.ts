/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getCreators } from "@/app/api/creators/route";
import { GET as getCampaigns } from "@/app/api/campaigns/route";
import { GET as getPayouts } from "@/app/api/payouts/route";
import { GET as getAuditLogs } from "@/app/api/audit-logs/route";
import { GET as getAuditLogsCsv } from "@/app/api/audit-logs/csv/route";
import { GET as getPortalDiscover } from "@/app/api/portal/discover/route";
import { GET as getFinancials } from "@/app/api/dashboard/financials/route";
import { GET as getFinancialsExport } from "@/app/api/dashboard/financials/export/route";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), count: jest.fn() },
    campaign: { findMany: jest.fn(), count: jest.fn() },
    payout: { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
    auditLog: { findMany: jest.fn(), count: jest.fn() },
    post: { findMany: jest.fn(), groupBy: jest.fn() },
    activation: { findMany: jest.fn() },
    campaignDeposit: { findMany: jest.fn() },
    proposal: { findMany: jest.fn() },
    payoutBalance: { findFirst: jest.fn(), findMany: jest.fn() },
    campaignProposal: { findMany: jest.fn(), count: jest.fn() },
    apiKey: { findUnique: jest.fn(), update: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({
  getOrgEntitlements: jest.fn(),
  hasOrgFeature: jest.fn(() => true),
  hasAnyOrgFeature: jest.fn(() => true),
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getCreatorSession } from "@/lib/creator-auth";
import { getOrgEntitlements } from "@/lib/entitlements";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;
const mockCreatorSession = getCreatorSession as jest.Mock;
const mockEntitlements = getOrgEntitlements as jest.Mock;

const READ_MOCKS = () => [
  mockDb.creator.findMany,
  mockDb.creator.count,
  mockDb.campaign.findMany,
  mockDb.campaign.count,
  mockDb.payout.findMany,
  mockDb.payout.count,
  mockDb.payout.aggregate,
  mockDb.auditLog.findMany,
  mockDb.auditLog.count,
  mockDb.post.findMany,
  mockDb.activation.findMany,
];

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: "user-1", orgId: "org-1", email: "u@org-1.test", role: "ADMIN" },
  });
  mockCreatorSession.mockResolvedValue({
    creatorUserId: "cuser-1",
    handle: "blessingjolie",
  });
  mockEntitlements.mockResolvedValue({
    features: ["audit_log"],
    featureMap: { audit_log: true },
  });
  for (const m of READ_MOCKS()) m.mockResolvedValue([]);
  mockDb.creator.count.mockResolvedValue(0);
  mockDb.campaign.count.mockResolvedValue(0);
  mockDb.payout.count.mockResolvedValue(0);
  mockDb.auditLog.count.mockResolvedValue(0);
  mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  mockDb.campaignDeposit.findMany.mockResolvedValue([]);
  mockDb.proposal.findMany.mockResolvedValue([]);
  mockDb.payoutBalance.findFirst.mockResolvedValue(null);
  mockDb.payoutBalance.findMany.mockResolvedValue([]);
  mockDb.campaignProposal.findMany.mockResolvedValue([]);
  mockDb.campaignProposal.count.mockResolvedValue(0);
  // The delivery rollup aggregates in the database now.
  mockDb.post.groupBy.mockResolvedValue([]);
  mockDb.$queryRawUnsafe.mockResolvedValue([]);
});

type Handler = (req: NextRequest) => Promise<Response>;

const ROUTES: Array<{
  name: string;
  path: string;
  handler: Handler;
  rejects: string[];
  accepts: string[];
}> = [
  {
    name: "GET /api/creators",
    path: "http://localhost/api/creators",
    handler: getCreators as Handler,
    rejects: ["?page=abc", "?limit=abc", "?page=-5", "?page=0", "?limit=0", "?limit=100000"],
    accepts: ["", "?page=2&limit=50", "?limit=200"],
  },
  {
    name: "GET /api/campaigns",
    path: "http://localhost/api/campaigns",
    handler: getCampaigns as Handler,
    rejects: ["?page=abc", "?limit=abc", "?page=-5", "?limit=100000", "?status=NOPE"],
    accepts: ["", "?status=IN_PROGRESS&page=2&limit=50"],
  },
  {
    name: "GET /api/payouts",
    path: "http://localhost/api/payouts",
    handler: getPayouts as Handler,
    rejects: ["?page=abc", "?limit=abc", "?page=-5", "?limit=100000", "?status=NOPE"],
    accepts: ["", "?status=SUCCESS&page=2&limit=50"],
  },
  {
    name: "GET /api/audit-logs",
    path: "http://localhost/api/audit-logs",
    handler: getAuditLogs as Handler,
    rejects: ["?page=abc", "?pageSize=abc", "?page=-5", "?pageSize=100000", "?from=abc", "?to=abc"],
    accepts: ["", "?page=2&pageSize=100", "?from=2026-01-01&to=2026-02-01"],
  },
  {
    name: "GET /api/audit-logs/csv",
    path: "http://localhost/api/audit-logs/csv",
    handler: getAuditLogsCsv as Handler,
    rejects: ["?from=abc", "?to=abc"],
    accepts: ["", "?from=2026-01-01&to=2026-02-01"],
  },
  {
    name: "GET /api/portal/discover",
    path: "http://localhost/api/portal/discover",
    handler: getPortalDiscover as Handler,
    rejects: ["?page=abc", "?limit=abc", "?page=-5", "?limit=100000", "?minBudget=abc", "?maxBudget=abc", "?campaignType=NOPE"],
    accepts: ["", "?campaignType=ALL", "?campaignType=BUDGET_BASED&minBudget=100&maxBudget=900"],
  },
  {
    name: "GET /api/dashboard/financials",
    path: "http://localhost/api/dashboard/financials",
    handler: getFinancials as Handler,
    rejects: ["?from=abc", "?to=abc", "?granularity=chaos"],
    accepts: ["", "?granularity=daily", "?granularity=weekly", "?granularity=monthly"],
  },
  {
    name: "GET /api/dashboard/financials/export",
    path: "http://localhost/api/dashboard/financials/export",
    handler: getFinancialsExport as Handler,
    rejects: ["?from=abc", "?to=abc", "?type=chaos", "?type=payouts"],
    accepts: ["", "?type=campaigns", "?type=creators"],
  },
];

describe.each(ROUTES)("$name query validation", ({ path, handler, rejects, accepts }) => {
  it.each(rejects)("rejects %s with 400 and never touches the database", async (query) => {
    const res = await handler(new NextRequest(`${path}${query}`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid input");
    expect(body.details).toBeDefined();
    for (const m of READ_MOCKS()) expect(m).not.toHaveBeenCalled();
  });

  it.each(accepts)("accepts %s", async (query) => {
    const res = await handler(new NextRequest(`${path}${query}`));
    expect(res.status).toBeLessThan(400);
  });
});

describe("the 100-row page-size cap", () => {
  it("is enforced at 100 on every swept route that paginates, except creators", async () => {
    for (const path of [
      "http://localhost/api/campaigns",
      "http://localhost/api/payouts",
      "http://localhost/api/portal/discover",
    ]) {
      const handler = ROUTES.find((r) => r.path === path)!.handler;
      expect((await handler(new NextRequest(`${path}?limit=100`))).status).toBeLessThan(400);
      expect((await handler(new NextRequest(`${path}?limit=101`))).status).toBe(400);
    }
    expect((await (getAuditLogs as Handler)(new NextRequest("http://localhost/api/audit-logs?pageSize=100"))).status).toBeLessThan(400);
    expect((await (getAuditLogs as Handler)(new NextRequest("http://localhost/api/audit-logs?pageSize=101"))).status).toBe(400);
  });

  it("is raised to 200 on creators only, because an in-app caller requests 200", async () => {
    const res200 = await (getCreators as Handler)(new NextRequest("http://localhost/api/creators?limit=200"));
    expect(res200.status).toBeLessThan(400);
    const res201 = await (getCreators as Handler)(new NextRequest("http://localhost/api/creators?limit=201"));
    expect(res201.status).toBe(400);
  });
});
