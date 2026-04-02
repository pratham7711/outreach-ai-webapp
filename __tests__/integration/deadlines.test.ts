/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getDeadlines } from "@/app/api/deadlines/route";
import { PATCH as patchActivation } from "@/app/api/activations/[id]/route";

jest.mock("@/lib/db", () => ({
  db: {
    activation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({
  createAuditActor: jest.fn(() => ({})),
  logAudit: jest.fn(),
}));
jest.mock("@/lib/request", () => ({ getRequestIp: jest.fn(() => "127.0.0.1") }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days from now
const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);   // 2 days ago

const sampleActivations = [
  {
    id: "act-1",
    status: "AWAITING_DRAFT",
    deliverableDueDate: futureDate,
    feedbackNotes: null,
    creator: { id: "cr-1", name: "Creator One", handle: "creator1", platform: "INSTAGRAM" },
    campaign: { id: "camp-1", title: "Spring Campaign", status: "IN_PROGRESS" },
  },
  {
    id: "act-2",
    status: "AWAITING_DRAFT",
    deliverableDueDate: pastDate,
    feedbackNotes: null,
    creator: { id: "cr-2", name: "Creator Two", handle: "creator2", platform: "TIKTOK" },
    campaign: { id: "camp-1", title: "Spring Campaign", status: "IN_PROGRESS" },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

function makeGetRequest(url: string) {
  return new NextRequest(url);
}

function makePatchRequest(id: string, body: object) {
  return new NextRequest(`http://localhost/api/activations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── GET /api/deadlines ────────────────────────────────────────────────────

describe("GET /api/deadlines", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeGetRequest("http://localhost/api/deadlines");
    const res = await getDeadlines(req);
    expect(res.status).toBe(401);
  });

  it("returns activations and stats", async () => {
    mockDb.activation.findMany
      .mockResolvedValueOnce(sampleActivations) // filtered list
      .mockResolvedValueOnce(sampleActivations); // all for stats

    const req = makeGetRequest("http://localhost/api/deadlines?filter=ALL");
    const res = await getDeadlines(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activations).toHaveLength(2);
    expect(body.stats).toHaveProperty("total");
    expect(body.stats).toHaveProperty("overdue");
    expect(body.stats).toHaveProperty("dueThisWeek");
    expect(body.stats).toHaveProperty("completed");
    expect(body.stats).toHaveProperty("noDate");
  });

  it("filters by OVERDUE — adds lt:now and excludes COMPLETE/DECLINED", async () => {
    mockDb.activation.findMany
      .mockResolvedValueOnce([sampleActivations[1]]) // only overdue
      .mockResolvedValueOnce(sampleActivations);

    const req = makeGetRequest("http://localhost/api/deadlines?filter=OVERDUE");
    const res = await getDeadlines(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Verify the where clause included overdue logic
    const firstCall = mockDb.activation.findMany.mock.calls[0][0];
    expect(firstCall.where.deliverableDueDate).toHaveProperty("lt");
    expect(firstCall.where.NOT).toEqual({ status: { in: ["COMPLETE", "DECLINED"] } });
  });

  it("filters by NO_DATE — sets deliverableDueDate: null", async () => {
    mockDb.activation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(sampleActivations);

    const req = makeGetRequest("http://localhost/api/deadlines?filter=NO_DATE");
    const res = await getDeadlines(req);

    expect(res.status).toBe(200);
    const firstCall = mockDb.activation.findMany.mock.calls[0][0];
    expect(firstCall.where.deliverableDueDate).toBeNull();
  });

  it("computes overdue count from stats correctly", async () => {
    const statsActivations = [
      { deliverableDueDate: pastDate, status: "AWAITING_DRAFT" },  // overdue
      { deliverableDueDate: futureDate, status: "AWAITING_DRAFT" }, // upcoming
      { deliverableDueDate: pastDate, status: "COMPLETE" },          // complete — NOT overdue
      { deliverableDueDate: null, status: "AWAITING_DRAFT" },        // no date
    ];

    mockDb.activation.findMany
      .mockResolvedValueOnce([]) // filtered list
      .mockResolvedValueOnce(statsActivations);

    const req = makeGetRequest("http://localhost/api/deadlines?filter=ALL");
    const res = await getDeadlines(req);
    const body = await res.json();

    expect(body.stats.overdue).toBe(1);
    expect(body.stats.total).toBe(3);  // 3 have a date
    expect(body.stats.completed).toBe(1);
    expect(body.stats.noDate).toBe(1);
  });
});

// ─── PATCH deliverableDueDate via /api/activations/[id] ───────────────────

describe("PATCH /api/activations/[id] — deliverableDueDate", () => {
  const existingActivation = {
    id: "act-1",
    status: "AWAITING_DRAFT",
    deliverableDueDate: null,
    feedbackNotes: null,
    postedUrl: null,
  };

  it("sets deliverableDueDate when provided as ISO string", async () => {
    mockDb.activation.findFirst.mockResolvedValue(existingActivation);
    mockDb.activation.update.mockResolvedValue({
      ...existingActivation,
      deliverableDueDate: futureDate,
    });

    const req = makePatchRequest("act-1", { deliverableDueDate: futureDate.toISOString() });
    const res = await patchActivation(req, { params: Promise.resolve({ id: "act-1" }) });

    expect(res.status).toBe(200);
    const updateCall = mockDb.activation.update.mock.calls[0][0];
    expect(updateCall.data.deliverableDueDate).toBeInstanceOf(Date);
  });

  it("clears deliverableDueDate when null is passed", async () => {
    mockDb.activation.findFirst.mockResolvedValue({
      ...existingActivation,
      deliverableDueDate: futureDate,
    });
    mockDb.activation.update.mockResolvedValue({
      ...existingActivation,
      deliverableDueDate: null,
    });

    const req = makePatchRequest("act-1", { deliverableDueDate: null });
    const res = await patchActivation(req, { params: Promise.resolve({ id: "act-1" }) });

    expect(res.status).toBe(200);
    const updateCall = mockDb.activation.update.mock.calls[0][0];
    expect(updateCall.data.deliverableDueDate).toBeNull();
  });

  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makePatchRequest("act-1", { deliverableDueDate: futureDate.toISOString() });
    const res = await patchActivation(req, { params: Promise.resolve({ id: "act-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when activation not in org", async () => {
    mockDb.activation.findFirst.mockResolvedValue(null);
    const req = makePatchRequest("no-such-id", { deliverableDueDate: futureDate.toISOString() });
    const res = await patchActivation(req, { params: Promise.resolve({ id: "no-such-id" }) });
    expect(res.status).toBe(404);
  });
});
