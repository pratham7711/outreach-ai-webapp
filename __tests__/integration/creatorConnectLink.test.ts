/**
 * @jest-environment node
 *
 * /api/creators/[id]/connect-link — the agency side of the connect link.
 * A person in the org (not a viewer, not an API key) makes, rotates and
 * revokes the link for one of the org's own roster rows; the org always comes
 * from the session, so another org's creator is a plain 404.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findFirst: jest.fn() },
    creatorConnectToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(),
  getAuditActor: (a: { userId: string | null; actorType: string }) => ({
    userId: a.userId ?? undefined,
    actorType: a.actorType,
  }),
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/connectTables", () => ({ connectTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { hashConnectToken } from "@/lib/creators/connectToken";
import { DELETE, GET, POST } from "@/app/api/creators/[id]/connect-link/route";

const mockDb = db as unknown as {
  creator: { findFirst: jest.Mock };
  creatorConnectToken: { updateMany: jest.Mock; create: jest.Mock; findFirst: jest.Mock };
  $transaction: jest.Mock;
};
const mockAuth = authenticateRequest as jest.Mock;
const mockAudit = logAudit as jest.Mock;
const mockReady = connectTablesReady as jest.Mock;

const URL_BASE = "http://localhost:3009/api/creators/c-1/connect-link";
const params = { params: Promise.resolve({ id: "c-1" }) };

function user(role: string) {
  return {
    orgId: "org-1",
    userId: "u-1",
    actorEmail: "member@example.test",
    actorType: "user",
    role,
    campaignScope: "ALL",
  };
}

function req(method: string, body?: unknown) {
  return new NextRequest(URL_BASE, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

const savedAppUrl = process.env.APP_URL;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APP_URL = "https://app.example.test";
  mockAuth.mockResolvedValue(user("MEMBER"));
  mockReady.mockResolvedValue(true);
  mockDb.creator.findFirst.mockResolvedValue({ id: "c-1", name: "Fake Creator" });
  mockDb.creatorConnectToken.updateMany.mockResolvedValue({ count: 0 });
  mockDb.creatorConnectToken.create.mockResolvedValue({ id: "tok-1", createdAt: new Date("2026-10-01T00:00:00Z") });
  mockDb.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

afterAll(() => {
  if (savedAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = savedAppUrl;
});

describe("who may touch a connect link", () => {
  it("401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST(req("POST"), params)).status).toBe(401);
  });

  it("403 for a viewer", async () => {
    mockAuth.mockResolvedValue(user("VIEWER"));
    expect((await POST(req("POST"), params)).status).toBe(403);
    expect(mockDb.creatorConnectToken.create).not.toHaveBeenCalled();
  });

  it("403 for an API key, whatever its org", async () => {
    mockAuth.mockResolvedValue({ ...user("ADMIN"), actorType: "api_key", userId: null, role: null });
    expect((await POST(req("POST"), params)).status).toBe(403);
  });

  it("404 for a creator outside the caller's org, looked up by the session's org", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    expect((await POST(req("POST"), params)).status).toBe(404);
    expect(mockDb.creator.findFirst.mock.calls[0][0].where).toEqual({
      id: "c-1",
      orgId: "org-1",
      deletedAt: null,
    });
    expect(mockDb.creatorConnectToken.create).not.toHaveBeenCalled();
  });

  it("503 while the table does not exist yet", async () => {
    mockReady.mockResolvedValue(false);
    expect((await POST(req("POST"), params)).status).toBe(503);
  });
});

describe("POST", () => {
  it("makes a link for this row, returns it once, and stores only its hash", async () => {
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\/app\.example\.test\/connect\/[A-Za-z0-9_-]{43}$/);
    const token = body.path.replace("/connect/", "");

    const data = mockDb.creatorConnectToken.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ orgId: "org-1", creatorId: "c-1", createdById: "u-1" });
    expect(data.tokenHash).toBe(hashConnectToken(token));
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      orgId: "org-1",
      action: "creator.connect_link_created",
      entityId: "c-1",
    });
    // The link never goes into the audit trail.
    expect(JSON.stringify(mockAudit.mock.calls[0][0])).not.toContain(token);
  });

  it("rotating revokes the live link first", async () => {
    await POST(req("POST", { action: "rotate" }), params);
    expect(mockDb.creatorConnectToken.updateMany.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      creatorId: "c-1",
      revokedAt: null,
    });
  });

  it("'request' records a request and sends nothing to anyone", async () => {
    const res = await POST(req("POST", { action: "request" }), params);
    expect(res.status).toBe(201);
    expect((await res.json()).action).toBe("request");
    expect(mockAudit.mock.calls[0][0].action).toBe("creator.connection_requested");
  });

  it("400 for an unknown action", async () => {
    expect((await POST(req("POST", { action: "email-it" }), params)).status).toBe(400);
  });
});

describe("GET and DELETE", () => {
  it("GET reports a live link without revealing it", async () => {
    mockDb.creatorConnectToken.findFirst.mockResolvedValue({
      createdAt: new Date("2026-10-01T00:00:00Z"),
      usedAt: null,
    });
    const body = await (await GET(req("GET"), params)).json();
    expect(body).toEqual({ active: true, createdAt: "2026-10-01T00:00:00.000Z", usedAt: null });
  });

  it("DELETE revokes this org's live link for this row and audits it", async () => {
    mockDb.creatorConnectToken.updateMany.mockResolvedValue({ count: 1 });
    const body = await (await DELETE(req("DELETE"), params)).json();
    expect(body).toEqual({ revoked: 1 });
    expect(mockDb.creatorConnectToken.updateMany.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      creatorId: "c-1",
      revokedAt: null,
    });
    expect(mockAudit.mock.calls[0][0].action).toBe("creator.connect_link_revoked");
  });

  it("DELETE with nothing live audits nothing", async () => {
    const body = await (await DELETE(req("DELETE"), params)).json();
    expect(body).toEqual({ revoked: 0 });
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
