/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getCalendar } from "@/app/api/calendar/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: {
      findMany: jest.fn(),
    },
    activation: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

function makeRequest(url: string) {
  return new NextRequest(url);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── GET /api/calendar ─────────────────────────────────────────────────────

describe("GET /api/calendar", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/calendar?month=2026-03");
    const res = await getCalendar(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when month param is missing", async () => {
    const req = makeRequest("http://localhost/api/calendar");
    const res = await getCalendar(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/month/i);
  });

  it("returns campaigns and activations for the given month", async () => {
    const campaigns = [
      {
        id: "camp-1",
        title: "Spring Campaign",
        status: "IN_PROGRESS",
        createdAt: new Date("2026-03-01"),
        updatedAt: new Date("2026-03-15"),
      },
    ];
    const activations = [
      {
        id: "act-1",
        status: "PENDING",
        deliverableDueDate: new Date("2026-03-20"),
        creator: { id: "cr-1", name: "Creator One" },
        campaign: { id: "camp-1", title: "Spring Campaign" },
      },
    ];

    mockDb.campaign.findMany.mockResolvedValue(campaigns);
    mockDb.activation.findMany.mockResolvedValue(activations);

    const req = makeRequest("http://localhost/api/calendar?month=2026-03");
    const res = await getCalendar(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].id).toBe("camp-1");
    expect(body.activations).toHaveLength(1);
    expect(body.activations[0].id).toBe("act-1");
    expect(body.activations[0].creator.name).toBe("Creator One");

    // Verify orgId was used in campaign query
    expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1", deletedAt: null }),
      })
    );

    // Verify orgId was used in activation query
    expect(mockDb.activation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaign: { orgId: "org-1" },
          deletedAt: null,
        }),
      })
    );
  });

  it("returns empty arrays when no data exists for the month", async () => {
    mockDb.campaign.findMany.mockResolvedValue([]);
    mockDb.activation.findMany.mockResolvedValue([]);

    const req = makeRequest("http://localhost/api/calendar?month=2025-12");
    const res = await getCalendar(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaigns).toEqual([]);
    expect(body.activations).toEqual([]);
  });
});
