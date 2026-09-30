/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const tx = { creatorProfileLink: { delete: jest.fn(), update: jest.fn() }, creator: { update: jest.fn() } };
jest.mock("@/lib/db", () => ({
  db: {
    creatorProfileLink: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn(async () => true) }));

import { DELETE } from "@/app/api/creators/[id]/profile-links/[linkId]/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const mockAuth = auth as jest.Mock;
const findFirst = db.creatorProfileLink.findFirst as jest.Mock;
const findMany = db.creatorProfileLink.findMany as jest.Mock;

const JUNK = { id: "link-1", platform: "INSTAGRAM", handle: "any", isPrimary: false, creator: { name: "Synth Remove" } };
const OTHERS = [
  { id: "link-yt", platform: "YOUTUBE", handle: "synthremove", followersCount: 900, averageViews: 50 },
  { id: "link-ig", platform: "INSTAGRAM", handle: "synthremove.ig", followersCount: 1200, averageViews: null },
];

function del(id = "creator-1", linkId = "link-1") {
  return DELETE(new NextRequest(`http://localhost/api/creators/${id}/profile-links/${linkId}`, { method: "DELETE" }), {
    params: Promise.resolve({ id, linkId }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u-1", orgId: "org-1", role: "MEMBER", email: "m@example.com" } });
  findFirst.mockResolvedValue(JUNK);
  findMany.mockResolvedValue(OTHERS);
});

describe("DELETE /api/creators/[id]/profile-links/[linkId]", () => {
  it("refuses a signed-out caller and a VIEWER", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await del()).status).toBe(401);
    mockAuth.mockResolvedValueOnce({ user: { id: "u-2", orgId: "org-1", role: "VIEWER" } });
    expect((await del()).status).toBe(403);
    expect(tx.creatorProfileLink.delete).not.toHaveBeenCalled();
  });

  it("looks the link up inside the caller's org and creator only", async () => {
    findFirst.mockResolvedValueOnce(null);
    expect((await del()).status).toBe(404);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: "link-1", orgId: "org-1", creatorId: "creator-1", creator: { deletedAt: null } });
  });

  it("keeps the creator's only account", async () => {
    findMany.mockResolvedValueOnce([]);
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/only account/);
    expect(tx.creatorProfileLink.delete).not.toHaveBeenCalled();
  });

  it("removes a secondary account and leaves the creator alone", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(tx.creatorProfileLink.delete).toHaveBeenCalledWith({ where: { id: "link-1", orgId: "org-1" } });
    expect(tx.creator.update).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "creator.profile_link.delete", before: { platform: "INSTAGRAM", handle: "any", isPrimary: false }, after: null }),
    );
  });

  it("hands primary to the next account, Instagram before YouTube, and mirrors it onto the creator", async () => {
    findFirst.mockResolvedValueOnce({ ...JUNK, platform: "TIKTOK", handle: "banned", isPrimary: true });
    const res = await del();
    expect((await res.json()).primary).toEqual({ id: "link-ig", platform: "INSTAGRAM", handle: "synthremove.ig" });
    expect(tx.creatorProfileLink.update).toHaveBeenCalledWith({ where: { id: "link-ig", orgId: "org-1" }, data: { isPrimary: true } });
    expect(tx.creator.update).toHaveBeenCalledWith({
      where: { id: "creator-1", orgId: "org-1" },
      data: { platform: "INSTAGRAM", handle: "@synthremove.ig", followersCount: 1200, averageViews: 0 },
    });
  });
});
