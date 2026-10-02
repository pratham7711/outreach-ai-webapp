/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import * as shareRoute from "@/app/api/lists/[id]/share/route";

jest.mock("@/lib/db", () => ({
  db: {
    creatorList: { findFirst: jest.fn() },
    creatorListShare: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/lists/approvalTables", () => ({ listApprovalTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { DEFAULT_SHARE_REVIEW, LEGACY_SHARE_REVIEW } from "@/lib/lists/shareSettings";

const mockDb = db as any;
const params = { params: Promise.resolve({ id: "list-1" }) };
const call = (method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown) =>
  shareRoute[method](
    new NextRequest("http://localhost/api/lists/list-1/share", { method, ...(body !== undefined && { body: JSON.stringify(body) }) }),
    params,
  );
const FIELDS = { stats: true, tags: true, audienceCountry: true, price: false };
const live = (over: Record<string, unknown> = {}) => ({
  listId: "list-1",
  token: "old-fake-token",
  fields: { ...FIELDS, review: { ...DEFAULT_SHARE_REVIEW } },
  revokedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "MEMBER" } });
  (listApprovalTablesReady as jest.Mock).mockResolvedValue(true);
  mockDb.creatorList.findFirst.mockResolvedValue({ id: "list-1", name: "Spring pitch" });
  mockDb.creatorListShare.create.mockImplementation(async ({ data }: any) => ({ ...data, createdAt: new Date() }));
  mockDb.creatorListShare.update.mockImplementation(async ({ data }: any) => ({ ...live(), ...data }));
});

describe("GET /api/lists/[id]/share", () => {
  it("returns null for a list that was never shared, or whose link was revoked", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(null);
    expect(await (await call("GET")).json()).toEqual({ share: null });
    mockDb.creatorListShare.findUnique.mockResolvedValue(live({ revokedAt: new Date() }));
    expect(await (await call("GET")).json()).toEqual({ share: null });
  });

  it("reports the review switches beside the four display fields", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live());
    const { share } = await (await call("GET")).json();
    expect(share.fields).toEqual(FIELDS);
    expect(share.review).toEqual(DEFAULT_SHARE_REVIEW);
  });

  it("reports a link minted before review existed as review-off", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live({ fields: FIELDS }));
    expect((await (await call("GET")).json()).share.review).toEqual(LEGACY_SHARE_REVIEW);
  });

  it("leaves review out entirely while the approval tables are absent", async () => {
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(false);
    mockDb.creatorListShare.findUnique.mockResolvedValue(live());
    expect((await (await call("GET")).json()).share).not.toHaveProperty("review");
  });

  it("404s a list from another org", async () => {
    mockDb.creatorList.findFirst.mockResolvedValue(null);
    expect((await call("GET")).status).toBe(404);
    expect(mockDb.creatorList.findFirst.mock.calls[0][0].where).toEqual({ id: "list-1", orgId: "org-1" });
  });
});

describe("POST /api/lists/[id]/share", () => {
  it("mints a token with review on by default, stored inside the share's fields", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(null);
    const res = await call("POST", {});
    expect(res.status).toBe(201);
    const { share } = await res.json();
    expect(share.path).toBe(`/l/${share.token}`);
    expect(share.review).toEqual(DEFAULT_SHARE_REVIEW);
    expect(mockDb.creatorListShare.create.mock.calls[0][0].data.fields).toEqual({ ...FIELDS, review: DEFAULT_SHARE_REVIEW });
  });

  it("takes review switches with the first share", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(null);
    const { share } = await (await call("POST", { review: { feedback: false, platforms: ["TIKTOK"] } })).json();
    expect(share.review).toEqual({ ...DEFAULT_SHARE_REVIEW, feedback: false, platforms: ["TIKTOK"] });
  });

  it("mints without review while the approval tables are absent, and refuses review switches", async () => {
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(false);
    mockDb.creatorListShare.findUnique.mockResolvedValue(null);
    expect((await call("POST", { review: { approvals: true } })).status).toBe(503);
    await call("POST", {});
    expect(mockDb.creatorListShare.create.mock.calls[0][0].data.fields).toEqual(FIELDS);
  });

  it("issues a NEW token when re-sharing a revoked link", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live({ revokedAt: new Date() }));
    const { share } = await (await call("POST", {})).json();
    expect(share.token).not.toBe("old-fake-token");
    expect(mockDb.creatorListShare.update.mock.calls[0][0].data).toMatchObject({ revokedAt: null, token: share.token });
  });

  it("keeps a live token unless rotation is asked for", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live());
    const { share } = await (await call("POST", {})).json();
    expect(share.token).toBe("old-fake-token");
    expect(mockDb.creatorListShare.update).not.toHaveBeenCalled();
  });

  it("rotates a live token on request, keeping its settings, and audits the rotation", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live());
    const res = await call("POST", { rotate: true });
    expect(res.status).toBe(200);
    const { share } = await res.json();
    expect(share.token).not.toBe("old-fake-token");
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(mockDb.creatorListShare.update.mock.calls[0][0]).toEqual({ where: { listId: "list-1" }, data: { token: share.token } });
    expect(share.review).toEqual(DEFAULT_SHARE_REVIEW);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "list.share_rotate", entityId: "list-1" }));
  });

  it("lets a viewer read the link but not rotate it", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "VIEWER" } });
    mockDb.creatorListShare.findUnique.mockResolvedValue(live());
    expect((await call("POST", { rotate: true })).status).toBe(403);
    expect(mockDb.creatorListShare.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/lists/[id]/share", () => {
  it("switches review on for a legacy link, explicitly and only what is asked", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live({ fields: FIELDS }));
    const { share } = await (await call("PATCH", { review: { approvals: true } })).json();
    expect(share.review).toEqual({ ...LEGACY_SHARE_REVIEW, approvals: true });
    expect(share.token).toBe("old-fake-token");
  });

  it("keeps the stored review when only the display fields change", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live({ fields: { ...FIELDS, review: { ...DEFAULT_SHARE_REVIEW, rateTotal: true } } }));
    await call("PATCH", { fields: { price: true } });
    expect(mockDb.creatorListShare.update.mock.calls[0][0].data.fields).toEqual({
      ...FIELDS,
      price: true,
      review: { ...DEFAULT_SHARE_REVIEW, rateTotal: true },
    });
  });

  it("does not add review to a legacy link when only the display fields change", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live({ fields: FIELDS }));
    await call("PATCH", { fields: { tags: false } });
    expect(mockDb.creatorListShare.update.mock.calls[0][0].data.fields).toEqual({ ...FIELDS, tags: false });
  });

  it("refuses an unknown platform or switch", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live());
    expect((await call("PATCH", { review: { platforms: ["MYSPACE"] } })).status).toBe(400);
    expect((await call("PATCH", { review: { showAge: true } })).status).toBe(400);
    expect(mockDb.creatorListShare.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/lists/[id]/share", () => {
  it("revokes the link but keeps the row", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(live());
    expect(await (await call("DELETE")).json()).toEqual({ share: null });
    expect(mockDb.creatorListShare.update).toHaveBeenCalledWith({ where: { listId: "list-1" }, data: { revokedAt: expect.any(Date) } });
  });

  it("is a no-op on a list that is not shared", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(null);
    expect(await (await call("DELETE")).json()).toEqual({ share: null });
    expect(mockDb.creatorListShare.update).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    (auth as jest.Mock).mockResolvedValue(null);
    expect((await call("DELETE")).status).toBe(401);
  });
});
