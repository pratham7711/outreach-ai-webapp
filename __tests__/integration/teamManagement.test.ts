/**
 * @jest-environment node
 *
 * Removing a teammate, and changing what one can do.
 *
 * Neither existed. Invites could be created, resent and cancelled, but once
 * somebody accepted one there was no route to demote them and no route to take
 * their access away — `User.isActive` was written by nobody and read by nobody.
 *
 * The guards are the interesting part, and each is a way an org could otherwise
 * lock itself out or escalate: no editing yourself, no demoting or removing the
 * last owner, and only an owner may grant or revoke OWNER.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    user: { findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/request", () => ({ getRequestIp: jest.fn(() => "127.0.0.1") }));

import { PATCH, DELETE } from "@/app/api/team/[userId]/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;
const mockAudit = logAudit as jest.Mock;

const ORG = "org-1";
const ME = "u-me";

const as = (role: string, id: string = ME) =>
  mockAuth.mockResolvedValue({ user: { id, orgId: ORG, email: "me@acme.test", role } });

const ctx = (userId: string) => ({ params: Promise.resolve({ userId }) });

const patch = (userId: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/team/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    ctx(userId)
  );

const del = (userId: string) =>
  DELETE(
    new NextRequest(`http://localhost/api/team/${userId}`, { method: "DELETE" }),
    ctx(userId)
  );

const member = (over: Record<string, unknown> = {}) => ({
  id: "u-them",
  email: "them@acme.test",
  name: "Them",
  role: "MEMBER",
  isActive: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  as("OWNER");
  mockDb.user.findFirst.mockResolvedValue(member());
  mockDb.user.count.mockResolvedValue(2);
  mockDb.user.update.mockImplementation(async ({ data }: any) => ({ ...member(), ...data }));
});

// ─── Who may run the team ────────────────────────────────────────────────────

const REFUSED = ["MANAGER", "MEMBER", "VIEWER"];

describe("roles without users:manage", () => {
  it.each(REFUSED)("refuses %s changing a role", async (role) => {
    as(role);
    const res = await patch("u-them", { role: "ADMIN" });
    expect(res.status).toBe(403);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it.each(REFUSED)("refuses %s removing a member", async (role) => {
    as(role);
    const res = await del("u-them");
    expect(res.status).toBe(403);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("is a 401 rather than a 403 with no session at all", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await patch("u-them", { role: "ADMIN" })).status).toBe(401);
    expect((await del("u-them")).status).toBe(401);
  });
});

// ─── Tenancy ─────────────────────────────────────────────────────────────────

describe("another org's user", () => {
  it("is a 404, and the org is in the WHERE rather than compared afterwards", async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    const res = await patch("u-elsewhere", { role: "ADMIN" });
    expect(res.status).toBe(404);
    expect(mockDb.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u-elsewhere", orgId: ORG } })
    );
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
});

// ─── Editing yourself ────────────────────────────────────────────────────────

describe("your own row", () => {
  it("refuses a self role change", async () => {
    mockDb.user.findFirst.mockResolvedValue(member({ id: ME, role: "ADMIN" }));
    as("ADMIN");
    const res = await patch(ME, { role: "OWNER" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/your own role/i);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("refuses removing yourself", async () => {
    mockDb.user.findFirst.mockResolvedValue(member({ id: ME, role: "ADMIN" }));
    as("ADMIN");
    const res = await del(ME);
    expect(res.status).toBe(400);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
});

// ─── The owner role ──────────────────────────────────────────────────────────

describe("granting and revoking OWNER", () => {
  it("refuses an ADMIN promoting somebody to OWNER", async () => {
    as("ADMIN");
    const res = await patch("u-them", { role: "OWNER" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/only an owner/i);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN demoting an OWNER", async () => {
    as("ADMIN");
    mockDb.user.findFirst.mockResolvedValue(member({ role: "OWNER" }));
    const res = await patch("u-them", { role: "MEMBER" });
    expect(res.status).toBe(403);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN removing an OWNER", async () => {
    as("ADMIN");
    mockDb.user.findFirst.mockResolvedValue(member({ role: "OWNER" }));
    const res = await del("u-them");
    expect(res.status).toBe(403);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("lets an OWNER promote somebody to OWNER", async () => {
    const res = await patch("u-them", { role: "OWNER" });
    expect(res.status).toBe(200);
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u-them" }, data: { role: "OWNER" } })
    );
  });
});

// ─── The last owner ──────────────────────────────────────────────────────────

describe("the last owner", () => {
  beforeEach(() => {
    mockDb.user.findFirst.mockResolvedValue(member({ role: "OWNER" }));
    mockDb.user.count.mockResolvedValue(1);
  });

  it("cannot be demoted", async () => {
    const res = await patch("u-them", { role: "ADMIN" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/last owner/i);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("cannot be removed", async () => {
    const res = await del("u-them");
    expect(res.status).toBe(409);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("counts only owners who can still sign in", async () => {
    await del("u-them");
    expect(mockDb.user.count).toHaveBeenCalledWith({
      where: { orgId: ORG, role: "OWNER", isActive: true },
    });
  });

  it("is demotable once a second owner exists", async () => {
    mockDb.user.count.mockResolvedValue(2);
    const res = await patch("u-them", { role: "ADMIN" });
    expect(res.status).toBe(200);
  });
});

// ─── The happy paths ─────────────────────────────────────────────────────────

describe("changing a role", () => {
  it("writes the new role and audits the change", async () => {
    const res = await patch("u-them", { role: "MANAGER" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "MANAGER" });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        action: "user.role_change",
        entityType: "user",
        entityId: "u-them",
        before: { role: "MEMBER" },
        after: { role: "MANAGER" },
      })
    );
  });

  it("rejects a role that is not a role", async () => {
    const res = await patch("u-them", { role: "SUPERUSER" });
    expect(res.status).toBe(400);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("is a no-op when the role already matches", async () => {
    const res = await patch("u-them", { role: "MEMBER" });
    expect(res.status).toBe(200);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
});

describe("removing a member", () => {
  it("deactivates rather than deleting, and audits it", async () => {
    const res = await del("u-them");
    expect(res.status).toBe(200);
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u-them" }, data: { isActive: false } })
    );
    expect(mockDb.user.delete).toBeUndefined();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.deactivate",
        entityId: "u-them",
        after: { isActive: false, role: "MEMBER" },
      })
    );
  });

  it("is a no-op on somebody already removed", async () => {
    mockDb.user.findFirst.mockResolvedValue(member({ isActive: false }));
    const res = await del("u-them");
    expect(res.status).toBe(200);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
});
