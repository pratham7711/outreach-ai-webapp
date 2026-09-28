/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    creatorList: { findFirst: jest.fn() },
    creatorListShare: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    creatorListItem: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/creators/avatarStore", () => ({ readStoredAvatar: jest.fn() }));
jest.mock("@/lib/creators/avatarResponse", () => ({ serveAvatar: jest.fn(() => new Response("img", { status: 200 })) }));
jest.mock("@/lib/media/proxyImage", () => ({ imageDimension: (_: unknown, d: number) => d, resizeImage: jest.fn() }));

import * as shareRoute from "@/app/api/lists/[id]/share/route";
import { GET as avatar } from "@/app/api/l/[token]/avatar/[creatorId]/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { readStoredAvatar } from "@/lib/creators/avatarStore";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const params = { params: Promise.resolve({ id: "l1" }) };
const call = (method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown) =>
  shareRoute[method](
    new NextRequest("http://localhost/api/lists/l1/share", {
      method,
      ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
    params,
  );
const signIn = (role = "MEMBER") => (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1", role } });
const live = (over: Record<string, unknown> = {}) => ({
  listId: "l1",
  token: "old-token",
  fields: { stats: true, tags: true, audienceCountry: true, price: false },
  revokedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  signIn();
  (rosterTablesReady as jest.Mock).mockResolvedValue(true);
  mdb.creatorList.findFirst.mockResolvedValue({ id: "l1", name: "Anime Pages" });
  mdb.creatorListShare.create.mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date() }));
  mdb.creatorListShare.update.mockImplementation(async ({ data }) => ({ ...live(), ...data }));
});

describe("/api/lists/[id]/share", () => {
  it("mints a long random token with price off by default", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(null);
    const res = await call("POST", {});
    expect(res.status).toBe(201);
    const { share } = await res.json();
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(share.path).toBe(`/l/${share.token}`);
    expect(share.fields).toEqual({ stats: true, tags: true, audienceCountry: true, price: false });
    expect(mdb.creatorListShare.create.mock.calls[0][0].data).toMatchObject({ listId: "l1", orgId: "org-1", createdById: "u1" });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "list.share", entityId: "l1" }));
  });

  it("hands back the live link instead of minting a second one", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(live());
    const res = await call("POST", {});
    expect((await res.json()).share.token).toBe("old-token");
    expect(mdb.creatorListShare.create).not.toHaveBeenCalled();
    expect(mdb.creatorListShare.update).not.toHaveBeenCalled();
  });

  it("re-sharing after a revoke mints a new token, so the old link stays dead", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(live({ revokedAt: new Date() }));
    const { share } = await (await call("POST", { fields: { price: true } })).json();
    expect(share.token).not.toBe("old-token");
    expect(share.fields.price).toBe(true);
    expect(mdb.creatorListShare.update.mock.calls[0][0].data).toMatchObject({ revokedAt: null, token: share.token });
  });

  it("revoking stamps the row rather than deleting it", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(live());
    expect(await (await call("DELETE")).json()).toEqual({ share: null });
    expect(mdb.creatorListShare.update).toHaveBeenCalledWith({ where: { listId: "l1" }, data: { revokedAt: expect.any(Date) } });
  });

  it("GET reports a revoked link as no link", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(live({ revokedAt: new Date() }));
    expect(await (await call("GET")).json()).toEqual({ share: null });
  });

  it("PATCH changes the fields and keeps the token", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(live());
    const { share } = await (await call("PATCH", { fields: { tags: false } })).json();
    expect(share.token).toBe("old-token");
    expect(share.fields).toEqual({ stats: true, tags: false, audienceCountry: true, price: false });
  });

  it("PATCH on a list that isn't shared is a 404", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(live({ revokedAt: new Date() }));
    expect((await call("PATCH", { fields: { tags: false } })).status).toBe(404);
  });

  it("refuses an email field, unknown keys and bad JSON", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(null);
    expect((await call("POST", { fields: { email: true } })).status).toBe(400);
    expect((await call("POST", { fields: { price: "yes" } })).status).toBe(400);
    expect((await call("POST", { token: "chosen" })).status).toBe(400);
    expect((await call("POST", "{not json")).status).toBe(400);
    expect(mdb.creatorListShare.create).not.toHaveBeenCalled();
  });

  it("404s another org's list", async () => {
    mdb.creatorList.findFirst.mockResolvedValue(null);
    expect((await call("POST", {})).status).toBe(404);
    expect(mdb.creatorList.findFirst.mock.calls[0][0].where).toEqual({ id: "l1", orgId: "org-1" });
    expect(mdb.creatorListShare.findUnique).not.toHaveBeenCalled();
  });

  it("says so before the roster migration has run", async () => {
    (rosterTablesReady as jest.Mock).mockResolvedValue(false);
    expect((await call("GET")).status).toBe(503);
  });

  it("lets a viewer see the link but not create or revoke one", async () => {
    signIn("VIEWER");
    mdb.creatorListShare.findUnique.mockResolvedValue(live());
    expect((await call("GET")).status).toBe(200);
    expect((await call("POST", {})).status).toBe(403);
    expect((await call("DELETE")).status).toBe(403);
  });
});

describe("GET /api/l/[token]/avatar/[creatorId]", () => {
  const shareRow = (token: string, over: Record<string, unknown> = {}) => ({
    token,
    orgId: "org-1",
    fields: {},
    revokedAt: null,
    list: { id: "l1", orgId: "org-1", name: "Anime Pages", description: null, org: { name: "LKAY" } },
    ...over,
  });
  const fetchAvatar = (token: string, creatorId: string) =>
    avatar(new NextRequest(`http://localhost/api/l/${token}/avatar/${creatorId}?w=128`), {
      params: Promise.resolve({ token, creatorId }),
    });

  beforeEach(() => {
    (auth as jest.Mock).mockResolvedValue(null);
    mdb.creatorListItem.findMany.mockResolvedValue([{ creatorId: "member" }]);
  });

  it("serves a member's picture from the share's own org, with no session", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(shareRow("t-member"));
    expect((await fetchAvatar("t-member", "member")).status).toBe(200);
    expect(readStoredAvatar).toHaveBeenCalledWith("member", "org-1");
  });

  it("will not serve anyone who is not on the list", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(shareRow("t-outsider"));
    expect((await fetchAvatar("t-outsider", "outsider")).status).toBe(404);
    expect(readStoredAvatar).not.toHaveBeenCalled();
  });

  it("will not serve through an unknown or revoked token", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValueOnce(null);
    expect((await fetchAvatar("t-unknown", "member")).status).toBe(404);
    mdb.creatorListShare.findUnique.mockResolvedValueOnce(shareRow("t-revoked", { revokedAt: new Date() }));
    expect((await fetchAvatar("t-revoked", "member")).status).toBe(404);
    expect(readStoredAvatar).not.toHaveBeenCalled();
  });

  it("resolves a token once for a whole burst of pictures", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(shareRow("t-burst"));
    const res = await Promise.all(Array.from({ length: 24 }, () => fetchAvatar("t-burst", "member")));
    await fetchAvatar("t-burst", "member");
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(mdb.creatorListShare.findUnique).toHaveBeenCalledTimes(1);
    expect(mdb.creatorListItem.findMany).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failed lookup instead of remembering the failure", async () => {
    mdb.creatorListShare.findUnique.mockRejectedValueOnce(new Error("P1001")).mockResolvedValue(shareRow("t-flaky"));
    await expect(fetchAvatar("t-flaky", "member")).rejects.toThrow("P1001");
    expect((await fetchAvatar("t-flaky", "member")).status).toBe(200);
  });
});
