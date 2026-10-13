/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/notifications/route";

jest.mock("@/lib/db", () => ({
  db: {
    auditLog: { findMany: jest.fn(), count: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { NOTIFIABLE_ACTIONS } from "@/lib/notificationFeed";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;

const req = () => new NextRequest("http://localhost/api/notifications");

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", orgId: "org-1" } });
  mockDb.user.findUnique.mockResolvedValue({ notificationPrefs: null });
  mockDb.auditLog.findMany.mockResolvedValue([]);
  mockDb.auditLog.count.mockResolvedValue(0);
});

describe("GET /api/notifications honours the reader's own preferences", () => {
  it("selects the catalog defaults when the user has never touched a switch", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);

    const where = mockDb.auditLog.findMany.mock.calls[0][0].where;
    expect(where.orgId).toBe("org-1");
    // Defaults are a mix of on and off, so this is a strict subset, not the lot.
    expect(where.action.in.length).toBeGreaterThan(0);
    for (const a of where.action.in) expect(NOTIFIABLE_ACTIONS).toContain(a);
  });

  it("drops an action the user has switched off", async () => {
    const [first] = NOTIFIABLE_ACTIONS;
    mockDb.user.findUnique.mockResolvedValue({ notificationPrefs: { [first]: false } });

    await GET(req());

    const where = mockDb.auditLog.findMany.mock.calls[0][0].where;
    expect(where.action.in).not.toContain(first);
  });

  it("keeps an off-by-default action the user has switched on", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      notificationPrefs: Object.fromEntries(NOTIFIABLE_ACTIONS.map((a) => [a, true])),
    });

    await GET(req());

    const where = mockDb.auditLog.findMany.mock.calls[0][0].where;
    expect([...where.action.in].sort()).toEqual([...NOTIFIABLE_ACTIONS].sort());
  });

  it("returns an empty feed without querying when every switch is off", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      notificationPrefs: Object.fromEntries(NOTIFIABLE_ACTIONS.map((a) => [a, false])),
    });

    const res = await GET(req());

    expect(await res.json()).toEqual({ items: [], unreadCount: 0 });
    expect(mockDb.auditLog.findMany).not.toHaveBeenCalled();
    expect(mockDb.auditLog.count).not.toHaveBeenCalled();
  });

  it("is scoped to the session org, never a body-supplied one", async () => {
    await GET(req());
    for (const call of [
      ...mockDb.auditLog.findMany.mock.calls,
      ...mockDb.auditLog.count.mock.calls,
    ]) {
      expect(call[0].where.orgId).toBe("org-1");
    }
  });
});

describe("GET /api/notifications pages through the window", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `a${i}`,
      action: "campaign.update",
      entityType: "campaign",
      entityId: "c1",
      entityLabel: "LEAK IT (BTS)",
      createdAt: new Date(Date.UTC(2026, 9, 10, 0, 0, 60 - i)),
    }));
  const at = (q: string) => new NextRequest(`http://localhost/api/notifications${q}`);

  it("keeps the old page size when no limit is asked for", async () => {
    mockDb.auditLog.findMany.mockResolvedValue(rows(9));
    const body = await (await GET(at(""))).json();
    expect(mockDb.auditLog.findMany.mock.calls[0][0].take).toBe(9);
    expect(body.items).toHaveLength(8);
    expect(body.hasMore).toBe(true);
  });

  it("caps a requested page and says when there is nothing more", async () => {
    mockDb.auditLog.findMany.mockResolvedValue(rows(3));
    const body = await (await GET(at("?limit=5000"))).json();
    expect(mockDb.auditLog.findMany.mock.calls[0][0].take).toBe(51);
    expect(body.hasMore).toBe(false);
  });

  it("reads an older page from the cursor, still inside the window and the org, without recounting", async () => {
    mockDb.auditLog.findMany.mockResolvedValue(rows(2));
    const before = "2026-10-10T00:00:30.000Z";
    const body = await (await GET(at(`?limit=20&before=${encodeURIComponent(before)}`))).json();
    const where = mockDb.auditLog.findMany.mock.calls[0][0].where;
    expect(where.orgId).toBe("org-1");
    expect(where.createdAt.lte.toISOString()).toBe(before);
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(mockDb.auditLog.count).not.toHaveBeenCalled();
    expect(body.unreadCount).toBeUndefined();
  });

  it("starts strictly after the boundary row when the cursor names its id, so rows sharing one instant still page", async () => {
    mockDb.auditLog.findMany.mockResolvedValue(rows(2));
    const before = "2026-10-10T00:00:30.000Z";
    await GET(at(`?limit=20&before=${encodeURIComponent(before)}&beforeId=a7`));
    const where = mockDb.auditLog.findMany.mock.calls[0][0].where;
    expect(where.orgId).toBe("org-1");
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.OR).toEqual([
      { createdAt: { lt: new Date(before) } },
      { createdAt: new Date(before), id: { lt: "a7" } },
    ]);
  });

  it("ignores a cursor that is not a date", async () => {
    await GET(at("?before=nonsense"));
    expect(mockDb.auditLog.findMany.mock.calls[0][0].where.createdAt.lte).toBeUndefined();
    expect(mockDb.auditLog.count).toHaveBeenCalled();
  });
});
