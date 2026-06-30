/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getAuditLogs } from "@/app/api/audit-logs/route";
import { GET as getAuditLogsCsv } from "@/app/api/audit-logs/csv/route";

jest.mock("@/lib/db", () => ({
  db: {
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

jest.mock("@/lib/entitlements", () => ({
  ...jest.requireActual("@/lib/entitlements"),
  getOrgEntitlements: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const mockGetOrgEntitlements = getOrgEntitlements as jest.Mock;

const authedSession = { user: { id: "user-1", orgId: "org-1", email: "admin@demo.com" } };

const fakeLogs = [
  {
    id: "log-1",
    action: "campaign.create",
    entityType: "Campaign",
    entityId: "cam-1",
    entityLabel: "Summer Drop",
    actorType: "user",
    actorEmail: "admin@demo.com",
    ipAddress: "1.2.3.4",
    metadata: null,
    before: null,
    after: null,
    createdAt: new Date("2026-01-15T10:00:00Z"),
  },
  {
    id: "log-2",
    action: "creator.update",
    entityType: "Creator",
    entityId: "cre-1",
    entityLabel: "Jane Doe",
    actorType: "api_key",
    actorEmail: null,
    ipAddress: "5.6.7.8",
    metadata: null,
    before: null,
    after: null,
    createdAt: new Date("2026-01-14T09:00:00Z"),
  },
];

function makeRequest(url = "http://localhost/api/audit-logs") {
  return new NextRequest(url);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockGetOrgEntitlements.mockResolvedValue({
    planName: "pro",
    featureMap: { audit_log: true },
  });
  mockDb.auditLog.findMany.mockResolvedValue(fakeLogs);
  mockDb.auditLog.count.mockResolvedValue(2);
});

describe("GET /api/audit-logs", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await getAuditLogs(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns paginated logs with correct shape", async () => {
    const res = await getAuditLogs(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toHaveLength(2);
    expect(body.logs[0].action).toBe("campaign.create");
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.totalPages).toBe(1);
  });

  it("filters by action query param", async () => {
    mockDb.auditLog.findMany.mockResolvedValue([fakeLogs[0]]);
    mockDb.auditLog.count.mockResolvedValue(1);
    const res = await getAuditLogs(makeRequest("http://localhost/api/audit-logs?action=campaign.create"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // verify the db was called with action filter
    const call = mockDb.auditLog.findMany.mock.calls[0][0];
    expect(call.where.action).toBe("campaign.create");
  });

  it("filters by entityType query param", async () => {
    const res = await getAuditLogs(makeRequest("http://localhost/api/audit-logs?entityType=Creator"));
    expect(res.status).toBe(200);
    const call = mockDb.auditLog.findMany.mock.calls[0][0];
    expect(call.where.entityType).toBe("Creator");
  });

  it("applies org isolation — orgId always in where clause", async () => {
    const res = await getAuditLogs(makeRequest());
    expect(res.status).toBe(200);
    const call = mockDb.auditLog.findMany.mock.calls[0][0];
    expect(call.where.orgId).toBe("org-1");
  });

  it("applies pagination skip/take", async () => {
    const res = await getAuditLogs(makeRequest("http://localhost/api/audit-logs?page=2&pageSize=10"));
    expect(res.status).toBe(200);
    const call = mockDb.auditLog.findMany.mock.calls[0][0];
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });
});

describe("GET /api/audit-logs/csv", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await getAuditLogsCsv(makeRequest("http://localhost/api/audit-logs/csv"));
    expect(res.status).toBe(401);
  });

  it("returns CSV content type", async () => {
    const res = await getAuditLogsCsv(makeRequest("http://localhost/api/audit-logs/csv"));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("audit-log.csv");
  });

  it("returns CSV with header row and data rows", async () => {
    const res = await getAuditLogsCsv(makeRequest("http://localhost/api/audit-logs/csv"));
    const text = await res.text();
    expect(text).toContain("timestamp,actorEmail,actorType,action,entityType,entityLabel");
    expect(text).toContain("campaign.create");
    expect(text).toContain("admin@demo.com");
  });
});
