/**
 * @jest-environment node
 *
 * Who may see an invite token.
 *
 * /api/invites has always been gated on users:manage because its rows carry
 * `token`, and the accept endpoint checks the token and never the address it
 * was mailed to — so reading the list is enough to take over any pending invite
 * in the org, including one issued at OWNER. The Team *page* loaded the same
 * rows with `auth()` alone and no `select`, then handed them to a client
 * component that renders a copy-link button. A VIEWER could read every token
 * out of their own page source.
 */
jest.mock("@/lib/db", () => ({
  db: {
    user: { findMany: jest.fn() },
    userInvite: { findMany: jest.fn(), count: jest.fn() },
  },
}));
jest.mock("@/lib/entitlements", () => ({ getOrgEntitlements: jest.fn() }));

import { loadTeamPageData } from "@/lib/team/teamPageData";
import { db } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";

const mockDb = db as any;
const mockEntitlements = getOrgEntitlements as jest.Mock;

const ORG = "org-1";
const soon = new Date(Date.now() + 864e5);

beforeEach(() => {
  jest.clearAllMocks();
  mockEntitlements.mockResolvedValue({ limits: { maxUsers: Infinity } });
  mockDb.user.findMany.mockResolvedValue([
    {
      id: "u-1",
      name: "Ada",
      email: "ada@acme.test",
      role: "OWNER",
      avatarUrl: null,
      lastLoginAt: new Date("2026-01-02T03:04:05Z"),
      isActive: true,
    },
  ]);
  mockDb.userInvite.findMany.mockResolvedValue([
    {
      id: "inv-1",
      email: "new@person.test",
      role: "OWNER",
      token: "super-secret-token",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: soon,
      acceptedAt: null,
    },
  ]);
  mockDb.userInvite.count.mockResolvedValue(1);
});

const NON_MANAGERS = ["MANAGER", "MEMBER", "VIEWER"];
const MANAGERS = ["OWNER", "ADMIN"];

describe("a viewer without users:manage", () => {
  it.each(NON_MANAGERS)("gets no invite rows at all for %s", async (role) => {
    const data = await loadTeamPageData({ orgId: ORG, role });
    expect(data.canManage).toBe(false);
    expect(data.invites).toEqual([]);
    expect(mockDb.userInvite.findMany).not.toHaveBeenCalled();
  });

  it.each(NON_MANAGERS)("never returns a token anywhere in the payload for %s", async (role) => {
    const data = await loadTeamPageData({ orgId: ORG, role });
    expect(JSON.stringify(data)).not.toContain("super-secret-token");
  });

  it("still gets the seat counter, from a COUNT rather than the rows", async () => {
    const data = await loadTeamPageData({ orgId: ORG, role: "VIEWER" });
    expect(data.seats).toEqual({ used: 1, pending: 1, max: Infinity });
    expect(mockDb.userInvite.count).toHaveBeenCalledWith({
      where: { orgId: ORG, acceptedAt: null, expiresAt: { gt: expect.any(Date) } },
    });
  });

  it("treats a session with no role at all as unable to manage", async () => {
    const data = await loadTeamPageData({ orgId: ORG, role: null });
    expect(data.canManage).toBe(false);
    expect(data.invites).toEqual([]);
  });

  it("still returns the roster, which is not the sensitive part", async () => {
    const data = await loadTeamPageData({ orgId: ORG, role: "VIEWER" });
    expect(data.users).toHaveLength(1);
    expect(data.users[0].email).toBe("ada@acme.test");
  });
});

describe("a viewer with users:manage", () => {
  it.each(MANAGERS)("gets the invite rows including the token for %s", async (role) => {
    const data = await loadTeamPageData({ orgId: ORG, role });
    expect(data.canManage).toBe(true);
    expect(data.invites).toHaveLength(1);
    expect(data.invites[0].token).toBe("super-secret-token");
    expect(data.invites[0].status).toBe("pending");
  });

  it("scopes both queries to the session's org", async () => {
    await loadTeamPageData({ orgId: ORG, role: "OWNER" });
    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: ORG } })
    );
    expect(mockDb.userInvite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: ORG } })
    );
  });

  it("marks an invite past its expiry as expired", async () => {
    mockDb.userInvite.findMany.mockResolvedValue([
      {
        id: "inv-2",
        email: "old@person.test",
        role: "MEMBER",
        token: "t2",
        createdAt: new Date("2025-01-01T00:00:00Z"),
        expiresAt: new Date("2025-01-08T00:00:00Z"),
        acceptedAt: null,
      },
    ]);
    const data = await loadTeamPageData({ orgId: ORG, role: "ADMIN" });
    expect(data.invites[0].status).toBe("expired");
  });
});
