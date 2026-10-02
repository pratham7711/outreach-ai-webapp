/**
 * @jest-environment node
 *
 * The creator app's Account screen: change password, and Delete my account and
 * data. Deleting runs every connected account through Disconnect first -- the
 * connections route's own handler -- and only then removes the login.
 */
import { NextRequest, NextResponse } from "next/server";

jest.mock("@/lib/db", () => {
  const m = () => jest.fn();
  return {
    db: {
      $transaction: jest.fn(async (ops: unknown[]) => ops),
      creatorUser: { findUnique: m(), update: m(), delete: m() },
      creatorSession: { deleteMany: m() },
      creatorSocialAccount: { findMany: m(), deleteMany: m() },
      creator: { updateMany: m() },
      conversation: { findMany: m(), deleteMany: m() },
      message: { deleteMany: m() },
      negotiationOffer: { updateMany: m() },
      creatorTestimonial: { deleteMany: m() },
      campaignProposal: { deleteMany: m() },
      payoutRequest: { updateMany: m() },
    },
  };
});
jest.mock("@/lib/creator-auth", () => ({
  getCreatorSession: jest.fn(),
  verifyPassword: jest.fn(),
  hashPassword: jest.fn(async (p: string) => `hashed:${p}`),
  destroyCreatorSession: jest.fn(),
}));
jest.mock("@/lib/portal/creatorLink", () => ({ findLinkedCreatorsForHandle: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => undefined) }));
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
  rateLimitKey: jest.fn(() => "k"),
}));
jest.mock("@/app/api/portal/connections/route", () => ({ DELETE: jest.fn() }));

import { POST as changePassword } from "@/app/api/portal/account/password/route";
import { POST as deleteAccount } from "@/app/api/portal/account/delete/route";
import { DELETE as disconnect } from "@/app/api/portal/connections/route";
import { db } from "@/lib/db";
import { destroyCreatorSession, getCreatorSession, verifyPassword } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { logAudit } from "@/lib/audit";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
const session = { id: "s-1", creatorUserId: "cu-1", email: "c@example.test", name: "Fake", handle: "fake_creator_one" };

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  jest.clearAllMocks();
  (getCreatorSession as jest.Mock).mockResolvedValue(session);
  (verifyPassword as jest.Mock).mockResolvedValue(true);
  mdb.creatorUser.findUnique.mockResolvedValue({ passwordHash: "stored" });
  (findLinkedCreatorsForHandle as jest.Mock).mockResolvedValue([
    { id: "cr-1", orgId: "org-1" },
    { id: "cr-2", orgId: "org-2" },
  ]);
  mdb.creatorSocialAccount.findMany.mockResolvedValue([
    { id: "sa-1", platform: "TIKTOK" },
    { id: "sa-2", platform: "INSTAGRAM" },
  ]);
  mdb.conversation.findMany.mockResolvedValue([]);
  (disconnect as jest.Mock).mockResolvedValue(NextResponse.json({ success: true }));
});

describe("POST /api/portal/account/password", () => {
  const call = (body: unknown = { currentPassword: "old-pass", newPassword: "new-password-1" }) =>
    changePassword(post("/api/portal/account/password", body));

  it("401s without a session", async () => {
    (getCreatorSession as jest.Mock).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("refuses a new password under 8 characters", async () => {
    expect((await call({ currentPassword: "old-pass", newPassword: "short" })).status).toBe(400);
    expect(mdb.creatorUser.update).not.toHaveBeenCalled();
  });

  it("refuses a wrong current password", async () => {
    (verifyPassword as jest.Mock).mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(mdb.creatorUser.update).not.toHaveBeenCalled();
  });

  it("stores the new hash and signs out every other session", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mdb.creatorUser.update).toHaveBeenCalledWith({
      where: { id: "cu-1" },
      data: { passwordHash: "hashed:new-password-1" },
    });
    expect(mdb.creatorSession.deleteMany).toHaveBeenCalledWith({
      where: { creatorUserId: "cu-1", id: { not: "s-1" } },
    });
  });
});

describe("POST /api/portal/account/delete", () => {
  const call = (body: unknown = { password: "pw", confirm: "DELETE" }) =>
    deleteAccount(post("/api/portal/account/delete", body));

  it("401s without a session", async () => {
    (getCreatorSession as jest.Mock).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("needs DELETE typed out", async () => {
    expect((await call({ password: "pw", confirm: "delete" })).status).toBe(400);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("needs the password", async () => {
    (verifyPassword as jest.Mock).mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(disconnect).not.toHaveBeenCalled();
    expect(mdb.creatorUser.delete).not.toHaveBeenCalled();
  });

  it("runs Disconnect for every account the creator connected, then removes the login", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, disconnected: 2 });

    const ids = (disconnect as jest.Mock).mock.calls.map(
      ([req]: [NextRequest]) => req.nextUrl.searchParams.get("id"),
    );
    expect(ids).toEqual(["sa-1", "sa-2"]);
    expect((disconnect as jest.Mock).mock.calls[0][0].method).toBe("DELETE");

    // Only the creator's own accounts, never an agency's hand-typed row.
    expect(mdb.creatorSocialAccount.findMany.mock.calls[0][0].where).toEqual({
      AND: [
        { OR: [{ creatorId: { in: ["cr-1", "cr-2"] } }, { creatorUserId: "cu-1" }] },
        { OR: [{ origin: null }, { origin: { not: "manual" } }] },
      ],
    });

    expect(mdb.creatorUser.delete).toHaveBeenCalledWith({ where: { id: "cu-1" } });
    expect(mdb.creator.updateMany).toHaveBeenCalledWith({
      where: { creatorUserId: "cu-1" },
      data: { creatorUserId: null },
    });
    expect(mdb.payoutRequest.updateMany).toHaveBeenCalledWith({
      where: { creatorUserId: "cu-1" },
      data: { creatorUserId: null },
    });
    expect(mdb.creatorSocialAccount.deleteMany).toHaveBeenCalledWith({ where: { creatorUserId: "cu-1" } });
    expect(mdb.creatorSession.deleteMany).toHaveBeenCalledWith({ where: { creatorUserId: "cu-1" } });
    expect(destroyCreatorSession).toHaveBeenCalled();
    expect(mdb.$transaction).toHaveBeenCalledTimes(1);

    // Each agency the creator worked with gets an audit entry.
    expect((logAudit as jest.Mock).mock.calls.map(([a]: [{ orgId: string }]) => a.orgId)).toEqual([
      "org-1",
      "org-2",
    ]);
  });

  it("removes the creator's message threads before the login", async () => {
    mdb.conversation.findMany.mockResolvedValue([{ id: "conv-1" }]);
    await call();
    expect(mdb.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: { in: ["conv-1"] } } });
    expect(mdb.conversation.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["conv-1"] } } });
    expect(mdb.negotiationOffer.updateMany).toHaveBeenCalledWith({
      where: { conversationId: { in: ["conv-1"] } },
      data: { conversationId: null },
    });
  });

  it("stops before deleting anything when a Disconnect fails", async () => {
    (disconnect as jest.Mock)
      .mockResolvedValueOnce(NextResponse.json({ success: true }))
      .mockResolvedValueOnce(NextResponse.json({ error: "boom" }, { status: 500 }));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/instagram/);
    expect(mdb.$transaction).not.toHaveBeenCalled();
    expect(mdb.creatorUser.delete).not.toHaveBeenCalled();
    expect(destroyCreatorSession).not.toHaveBeenCalled();
  });

  it("carries on past a 404 from Disconnect, deleting that row with the login", async () => {
    (disconnect as jest.Mock).mockResolvedValue(NextResponse.json({ error: "Not found" }, { status: 404 }));
    expect((await call()).status).toBe(200);
    expect(mdb.creatorUser.delete).toHaveBeenCalled();
  });
});
