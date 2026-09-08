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
