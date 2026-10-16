/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const tx = { creatorProfileLink: { update: jest.fn() }, creator: { update: jest.fn() } };
jest.mock("@/lib/db", () => ({
  db: {
    creatorProfileLink: { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn(async () => true) }));

import { PATCH } from "@/app/api/creators/[id]/profile-links/[linkId]/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const mockAuth = auth as jest.Mock;
const findFirst = db.creatorProfileLink.findFirst as jest.Mock;

const LINK = { id: "link-1", platform: "TIKTOK", handle: "synthfixx", isPrimary: true, creator: { name: "Synth Fix One" } };

function patch(body: unknown, id = "creator-1", linkId = "link-1") {
  return PATCH(
    new NextRequest(`http://localhost/api/creators/${id}/profile-links/${linkId}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id, linkId }) },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u-1", orgId: "org-1", role: "MEMBER", email: "m@example.com" } });
  // First lookup: the link being fixed. Second: whoever already holds the new handle.
  findFirst.mockResolvedValueOnce(LINK).mockResolvedValueOnce(null);
});

describe("PATCH /api/creators/[id]/profile-links/[linkId]", () => {
  it("refuses a signed-out caller and a VIEWER", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await patch({ handle: "synthfix01" })).status).toBe(401);
    mockAuth.mockResolvedValueOnce({ user: { id: "u-2", orgId: "org-1", role: "VIEWER" } });
    expect((await patch({ handle: "synthfix01" })).status).toBe(403);
    expect(tx.creatorProfileLink.update).not.toHaveBeenCalled();
  });

  it("looks the link up inside the caller's org and creator only", async () => {
    await patch({ handle: "synthfix01", orgId: "org-evil" });
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: "link-1", orgId: "org-1", creatorId: "creator-1" });
  });

  it("answers 404 for a link on another creator or org", async () => {
    findFirst.mockReset().mockResolvedValueOnce(null);
    expect((await patch({ handle: "synthfix01" })).status).toBe(404);
  });

  it("takes a pasted profile link, queues the account for the next read and mirrors the primary handle", async () => {
    const res = await patch({ handle: "https://www.tiktok.com/@SynthFix01?_t=abc" });
    expect(res.status).toBe(200);
    expect((await res.json()).link).toMatchObject({ handle: "synthfix01", url: "https://www.tiktok.com/@synthfix01", problem: null });
    expect(tx.creatorProfileLink.update).toHaveBeenCalledWith({
      where: { id: "link-1", orgId: "org-1" },
      data: { handle: "synthfix01", url: "https://www.tiktok.com/@synthfix01", refreshedAt: null, refreshError: null },
    });
    // Stored counts stay until the read replaces them; nothing here writes one.
    expect(tx.creatorProfileLink.update.mock.calls[0][0].data).not.toHaveProperty("followersCount");
    expect(tx.creator.update).toHaveBeenCalledWith({
      where: { id: "creator-1", orgId: "org-1" },
      data: { handle: "@synthfix01", trackerLastError: null, trackerLastAttemptAt: null },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "creator.profile_link.update", before: { platform: "TIKTOK", handle: "synthfixx" }, after: { platform: "TIKTOK", handle: "synthfix01" } }),
    );
  });

  it("leaves Creator.handle alone when the account is not the primary one", async () => {
    findFirst.mockReset().mockResolvedValueOnce({ ...LINK, isPrimary: false }).mockResolvedValueOnce(null);
    expect((await patch({ handle: "@synthfix01" })).status).toBe(200);
    expect(tx.creator.update).not.toHaveBeenCalled();
  });

  it("refuses another platform's link, an unchanged handle and a blank", async () => {
    const other = await patch({ handle: "https://www.instagram.com/synthfix01/" });
    expect(other.status).toBe(400);
    expect((await other.json()).error).toBe("That link is for Instagram; this account is on TikTok.");

    findFirst.mockReset().mockResolvedValueOnce(LINK);
    const same = await patch({ handle: "@SynthFixx" });
    expect(same.status).toBe(400);
    expect((await same.json()).error).toMatch(/already has/);

    expect((await patch({ handle: "  " })).status).toBe(400);
    expect(tx.creatorProfileLink.update).not.toHaveBeenCalled();
  });

  it("refuses a handle another creator already holds, naming them", async () => {
    findFirst.mockReset().mockResolvedValueOnce(LINK).mockResolvedValueOnce({ creator: { name: "Someone Else" } });
    const res = await patch({ handle: "taken" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("@taken is already on Someone Else's profile.");
    expect(tx.creatorProfileLink.update).not.toHaveBeenCalled();
  });

  it("never writes a count: figures come from the platforms, not from a person", async () => {
    findFirst.mockReset().mockResolvedValueOnce(LINK);
    const countsOnly = await patch({ followersCount: 102376, averageViews: 5400 });
    expect(countsOnly.status).toBe(400);
    expect(tx.creatorProfileLink.update).not.toHaveBeenCalled();

    findFirst.mockReset().mockResolvedValueOnce(LINK).mockResolvedValueOnce(null);
    const res = await patch({ handle: "synthfix01", followersCount: 2000, averageViews: null });
    expect(res.status).toBe(200);
    expect(tx.creatorProfileLink.update.mock.calls[0][0].data).toEqual({
      handle: "synthfix01",
      url: "https://www.tiktok.com/@synthfix01",
      refreshedAt: null,
      refreshError: null,
    });
    expect(tx.creator.update.mock.calls[0][0].data).toEqual({ handle: "@synthfix01", trackerLastError: null, trackerLastAttemptAt: null });
    expect((await res.json()).link).not.toHaveProperty("followersCount");
  });

  it("refuses an empty body", async () => {
    expect((await patch({})).status).toBe(400);
    expect(tx.creatorProfileLink.update).not.toHaveBeenCalled();
  });
});
