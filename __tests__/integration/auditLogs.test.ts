/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/audit-logs/route";

jest.mock("@/lib/db", () => ({
  db: {
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/entitlements", () => ({
  getOrgEntitlements: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;
const mockGetOrgEntitlements = getOrgEntitlements as jest.Mock;

function makeRequest(url: string) {
  return new NextRequest(url);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "ADMIN" } });
  mockGetOrgEntitlements.mockResolvedValue({
    planName: "pro",
    featureMap: { audit_log: true },
  });
});

describe("GET /api/audit-logs", () => {
  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);

    const req = makeRequest("http://localhost/api/audit-logs");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("returns 403 for insufficient role", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "VIEWER" } });

    const req = makeRequest("http://localhost/api/audit-logs");
    const res = await GET(req);

    expect(res.status).toBe(403);
  });

  it("returns 403 when audit log is disabled for the org", async () => {
    mockGetOrgEntitlements.mockResolvedValue({
      planName: "pro",
      featureMap: { audit_log: false },
    });

    const req = makeRequest("http://localhost/api/audit-logs");
    const res = await GET(req);

    expect(res.status).toBe(403);
    expect(mockDb.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("returns org-scoped logs with filters and pagination metadata", async () => {
    mockDb.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-2",
        action: "api_key.create",
        entityType: "api_key",
        entityId: "key-2",
        entityLabel: "Prod Key",
        actorType: "user",
        actorEmail: "admin@example.com",
        ipAddress: "127.0.0.1",
        metadata: { source: "ui" },
        before: null,
        after: { id: "key-2" },
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
      },
      {
        id: "audit-1",
        action: "api_key.create",
        entityType: "api_key",
        entityId: "key-1",
        entityLabel: "Staging Key",
        actorType: "user",
        actorEmail: "admin@example.com",
        ipAddress: "127.0.0.1",
        metadata: { source: "ui" },
        before: null,
        after: { id: "key-1" },
        createdAt: new Date("2026-03-30T09:00:00.000Z"),
      },
    ]);
    mockDb.auditLog.count.mockResolvedValue(5);

    const req = makeRequest(
      "http://localhost/api/audit-logs?page=2&pageSize=2&action=api_key.create&entityType=api_key&actorEmail=admin@example.com&q=key"
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.logs).toHaveLength(2);
    expect(body.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 5,
      totalPages: 3,
    });

    const findCall = mockDb.auditLog.findMany.mock.calls[0][0];
    expect(findCall.where.orgId).toBe("org-1");
    expect(findCall.where.action).toBe("api_key.create");
    expect(findCall.where.entityType).toBe("api_key");
    expect(findCall.where.actorEmail).toEqual({
      contains: "admin@example.com",
      mode: "insensitive",
    });
    expect(findCall.where.OR).toHaveLength(4);
    expect(findCall.orderBy).toEqual({ createdAt: "desc" });
    expect(findCall.skip).toBe(2);
    expect(findCall.take).toBe(2);
  });
});
