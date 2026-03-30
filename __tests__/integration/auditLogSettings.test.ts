/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, PATCH } from "@/app/api/settings/audit-log/route";

jest.mock("@/lib/db", () => ({
  db: {
    orgPlanConfig: {
      upsert: jest.fn(),
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

function makeRequest(url: string, body?: unknown) {
  return new NextRequest(url, body == null ? undefined : {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "ADMIN" } });
  mockGetOrgEntitlements.mockResolvedValue({
    planName: "pro",
    featureMap: { audit_log: true, reports: true, media_kits: true },
    limits: {
      maxCampaigns: 20,
      maxCreators: 500,
      maxUsers: 5,
    },
  });
});

describe("GET /api/settings/audit-log", () => {
  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("returns 403 for insufficient role", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "VIEWER" } });

    const res = await GET();

    expect(res.status).toBe(403);
  });

  it("returns the current enabled state and plan", async () => {
    mockGetOrgEntitlements.mockResolvedValue({
      planName: "enterprise",
      featureMap: { audit_log: false },
      limits: {
        maxCampaigns: 100,
        maxCreators: 1000,
        maxUsers: 25,
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ enabled: false, plan: "enterprise" });
    expect(mockGetOrgEntitlements).toHaveBeenCalledWith("org-1");
  });
});

describe("PATCH /api/settings/audit-log", () => {
  it("updates the org toggle and persists it to OrgPlanConfig", async () => {
    mockDb.orgPlanConfig.upsert.mockResolvedValue({
      id: "cfg-1",
      orgId: "org-1",
    });

    const req = makeRequest("http://localhost/api/settings/audit-log", { enabled: false });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ enabled: false, plan: "pro" });

    expect(mockDb.orgPlanConfig.upsert).toHaveBeenCalledWith({
      where: { orgId: "org-1" },
      update: {
        planName: "pro",
        maxCampaigns: 20,
        maxCreators: 500,
        maxUsers: 5,
        features: expect.objectContaining({
          audit_log: false,
          reports: true,
          media_kits: true,
        }),
      },
      create: {
        orgId: "org-1",
        planName: "pro",
        maxCampaigns: 20,
        maxCreators: 500,
        maxUsers: 5,
        features: expect.objectContaining({
          audit_log: false,
          reports: true,
          media_kits: true,
        }),
      },
    });
  });
});
