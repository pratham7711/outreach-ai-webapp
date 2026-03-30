/**
 * @jest-environment node
 *
 * Integration tests for GET/POST /api/reports
 */
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/reports/route";
import { GET as GET_REPORT, PATCH as PATCH_REPORT, DELETE as DELETE_REPORT } from "@/app/api/reports/[id]/route";

jest.mock("@/lib/db", () => ({
  db: {
    report: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/entitlements", () => ({
  getOrgEntitlements: jest.fn(),
  hasAnyOrgFeature: jest.fn((entitlements, features) =>
    Array.isArray(features) && features.some((feature) => entitlements?.featureMap?.[feature] === true)
  ),
  hasOrgFeature: jest.fn((entitlements, feature) => entitlements?.featureMap?.[feature] === true),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const mockGetOrgEntitlements = getOrgEntitlements as jest.Mock;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(url, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockGetOrgEntitlements.mockResolvedValue({
    planName: "pro",
    featureMap: {
      reports: true,
      basic_reports: true,
      advanced_reports: true,
    },
  });
});

// ─── GET /api/reports ─────────────────────────────────────────────────────────

describe("GET /api/reports", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns array of reports for the org", async () => {
    const mockReports = [
      {
        id: "rep-1",
        orgId: "org-1",
        title: "Q1 Report",
        slug: "q1-report",
        shareToken: "tok-1",
        isPublic: false,
        config: {},
        createdAt: new Date().toISOString(),
        campaign: null,
      },
    ];
    mockDb.report.findMany.mockResolvedValue(mockReports);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(mockReports);
    expect(mockDb.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-1" },
      })
    );
  });

  it("returns 403 when reports are disabled for the org", async () => {
    mockGetOrgEntitlements.mockResolvedValue({
      planName: "starter",
      featureMap: {
        reports: false,
        basic_reports: false,
        advanced_reports: false,
      },
    });

    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockDb.report.findMany).not.toHaveBeenCalled();
  });

  it("scopes query to the authenticated org only", async () => {
    mockDb.report.findMany.mockResolvedValue([]);

    await GET();

    const callArgs = mockDb.report.findMany.mock.calls[0][0];
    expect(callArgs.where.orgId).toBe("org-1");
    // Must NOT be missing orgId in where clause
    expect(callArgs.where).not.toHaveProperty("orgId", undefined);
  });

  it("returns empty array when org has no reports", async () => {
    mockDb.report.findMany.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it("orders results by createdAt descending", async () => {
    mockDb.report.findMany.mockResolvedValue([]);

    await GET();

    expect(mockDb.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      })
    );
  });
});

// ─── POST /api/reports ────────────────────────────────────────────────────────

describe("POST /api/reports", () => {
  const createdReport = {
    id: "rep-new",
    orgId: "org-1",
    title: "Campaign Report",
    slug: "campaign-report",
    shareToken: "unique-token-123",
    isPublic: false,
    config: {},
    createdById: "user-1",
    createdAt: new Date().toISOString(),
    campaign: null,
  };

  beforeEach(() => {
    // Default: slug doesn't already exist
    mockDb.report.findUnique.mockResolvedValue(null);
    mockDb.report.create.mockResolvedValue(createdReport);
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("creates a report and returns 201", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "Campaign Report" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.title).toBe("Campaign Report");
  });

  it("returns 403 when report features are disabled for the org", async () => {
    mockGetOrgEntitlements.mockResolvedValue({
      planName: "starter",
      featureMap: {
        reports: false,
        basic_reports: false,
        advanced_reports: false,
      },
    });

    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "Campaign Report" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockDb.report.create).not.toHaveBeenCalled();
  });

  it("returns 400 when title is missing", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/title/i);
  });

  it("returns 400 when title is empty string", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when title is not a string", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: 123 }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("scopes the new report to the authenticated org", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "New Report" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    expect(mockDb.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: "org-1" }),
      })
    );
  });

  it("records createdById from session user", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "New Report" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    expect(mockDb.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdById: "user-1" }),
      })
    );
  });

  it("auto-generates a slug from the title", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "My Campaign Report" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.report.create.mock.calls[0][0];
    expect(callArgs.data.slug).toBe("my-campaign-report");
  });

  it("increments slug when slug already exists", async () => {
    // First findUnique returns existing (slug taken), second returns null (slug-1 free)
    mockDb.report.findUnique
      .mockResolvedValueOnce({ id: "existing" }) // "my-report" taken
      .mockResolvedValueOnce(null);               // "my-report-1" free

    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "My Report" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.report.create.mock.calls[0][0];
    expect(callArgs.data.slug).toBe("my-report-1");
  });

  it("sets isPublic to false by default", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "Private Report" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.report.create.mock.calls[0][0];
    expect(callArgs.data.isPublic).toBe(false);
  });

  it("respects isPublic: true when provided", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "Public Report", isPublic: true }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.report.create.mock.calls[0][0];
    expect(callArgs.data.isPublic).toBe(true);
  });

  it("stores campaignId when provided", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "Campaign Report", campaignId: "camp-abc" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.report.create.mock.calls[0][0];
    expect(callArgs.data.campaignId).toBe("camp-abc");
  });

  it("sets campaignId to null when not provided", async () => {
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "Standalone Report" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.report.create.mock.calls[0][0];
    expect(callArgs.data.campaignId).toBeNull();
  });

  it("stores custom config when provided", async () => {
    const customConfig = { sections: ["overview", "posts"], metrics: ["views", "likes"] };
    const req = makeRequest("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify({ title: "Custom Report", config: customConfig }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.report.create.mock.calls[0][0];
    expect(callArgs.data.config).toEqual(customConfig);
  });
});

// ─── GET /api/reports/[id] ───────────────────────────────────────────────────

describe("GET /api/reports/[id]", () => {
  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET_REPORT(new NextRequest("http://localhost/api/reports/rep-1"), {
      params: Promise.resolve({ id: "rep-1" }),
    } as any);
    expect(res.status).toBe(401);
  });

  it("returns 403 when reports are disabled for the org", async () => {
    mockGetOrgEntitlements.mockResolvedValue({
      planName: "starter",
      featureMap: {
        reports: false,
        basic_reports: false,
        advanced_reports: false,
      },
    });

    const res = await GET_REPORT(new NextRequest("http://localhost/api/reports/rep-1"), {
      params: Promise.resolve({ id: "rep-1" }),
    } as any);
    expect(res.status).toBe(403);
    expect(mockDb.report.findFirst).not.toHaveBeenCalled();
  });

  it("returns the owned report for the org", async () => {
    mockDb.report.findFirst.mockResolvedValue({
      id: "rep-1",
      orgId: "org-1",
      title: "Q1 Report",
      slug: "q1-report",
      shareToken: "tok-1",
      isPublic: false,
      config: {},
      createdAt: new Date().toISOString(),
      campaign: { id: "camp-1", title: "Campaign" },
    });

    const res = await GET_REPORT(new NextRequest("http://localhost/api/reports/rep-1"), {
      params: Promise.resolve({ id: "rep-1" }),
    } as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("rep-1");
  });
});
