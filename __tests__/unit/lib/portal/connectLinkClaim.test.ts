/**
 * @jest-environment node
 */
import { claimConnectLink } from "@/lib/portal/connectLinkClaim";

jest.mock("@/lib/db", () => ({
  db: { creator: { findFirst: jest.fn(), updateMany: jest.fn() } },
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/connectToken", () => ({ resolveConnectToken: jest.fn() }));

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { resolveConnectToken } from "@/lib/creators/connectToken";

const mockDb = db as unknown as { creator: { findFirst: jest.Mock; updateMany: jest.Mock } };
const mockResolve = resolveConnectToken as jest.Mock;
const mockAudit = logAudit as jest.Mock;

const session = { creatorUserId: "cu-new", email: "new@creator.test" };
const binding = { tokenId: "t-1", orgId: "org-1", creatorId: "c-1", creatorHandle: "rostered" };

beforeEach(() => {
  jest.resetAllMocks();
  mockResolve.mockResolvedValue(binding);
});

describe("claimConnectLink", () => {
  it("links an unlinked roster row to the login, conditionally, and audits it", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "c-1", creatorUserId: null });
    mockDb.creator.updateMany.mockResolvedValue({ count: 1 });

    await expect(claimConnectLink(session, "raw")).resolves.toEqual({ ok: true, creatorId: "c-1", alreadyLinked: false });
    expect(mockDb.creator.findFirst.mock.calls[0][0].where).toEqual({ id: "c-1", orgId: "org-1", deletedAt: null });
    expect(mockDb.creator.updateMany).toHaveBeenCalledWith({
      where: { id: "c-1", orgId: "org-1", creatorUserId: null },
      data: { creatorUserId: "cu-new" },
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", action: "creator.connect_link_claimed", entityId: "c-1" }),
    );
  });

  it("is a no-op for a row already linked to this login", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "c-1", creatorUserId: "cu-new" });

    await expect(claimConnectLink(session, "raw")).resolves.toEqual({ ok: true, creatorId: "c-1", alreadyLinked: true });
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("refuses a row linked to another login and never moves it", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "c-1", creatorUserId: "cu-owner" });

    await expect(claimConnectLink(session, "raw")).resolves.toMatchObject({ ok: false, status: 409 });
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
  });

  it("refuses when another login claimed the row first", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "c-1", creatorUserId: null });
    mockDb.creator.updateMany.mockResolvedValue({ count: 0 });

    await expect(claimConnectLink(session, "raw")).resolves.toMatchObject({ ok: false, status: 409 });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("refuses a revoked or unknown link without reading the roster", async () => {
    mockResolve.mockResolvedValue(null);

    await expect(claimConnectLink(session, "raw")).resolves.toMatchObject({ ok: false, status: 404 });
    expect(mockDb.creator.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a link whose roster row was deleted", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);

    await expect(claimConnectLink(session, "raw")).resolves.toMatchObject({ ok: false, status: 404 });
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
  });
});
