/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    client: { findFirst: jest.fn() },
    folder: { findFirst: jest.fn() },
    song: { findFirst: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import { findForeignRef } from "@/lib/tenantRefs";

const mockDb = db as any;

/* A foreign-key id in a request body is the one place orgId-from-session does
   not protect: the row written belongs to the caller, but the relation it points
   at may not, and the next render joins it and prints another tenant's name. */

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.client.findFirst.mockResolvedValue({ id: "cl1" });
  mockDb.folder.findFirst.mockResolvedValue({ id: "f1" });
  mockDb.song.findFirst.mockResolvedValue({ id: "s1" });
});

describe("findForeignRef", () => {
  it("queries nothing when there is nothing to check", async () => {
    expect(await findForeignRef("org-1", {})).toBeNull();
    expect(await findForeignRef("org-1", { clientId: null, folderId: undefined })).toBeNull();
    expect(mockDb.client.findFirst).not.toHaveBeenCalled();
    expect(mockDb.folder.findFirst).not.toHaveBeenCalled();
  });

  it("passes when every reference belongs to the org", async () => {
    expect(await findForeignRef("org-1", { clientId: "cl1", folderId: "f1", songId: "s1" })).toBeNull();
  });

  it("names the folder when the folder is not ours", async () => {
    mockDb.folder.findFirst.mockResolvedValue(null);
    expect(await findForeignRef("org-1", { clientId: "cl1", folderId: "other-org-folder" })).toBe("folder");
  });

  it("names the client when the client is not ours", async () => {
    mockDb.client.findFirst.mockResolvedValue(null);
    expect(await findForeignRef("org-1", { clientId: "other-org-client" })).toBe("client");
  });

  it("names the song when the song is not ours", async () => {
    mockDb.song.findFirst.mockResolvedValue(null);
    expect(await findForeignRef("org-1", { songId: "other-org-song" })).toBe("song");
  });

  it("scopes every lookup by orgId, and skips soft-deleted songs", async () => {
    await findForeignRef("org-1", { clientId: "cl1", folderId: "f1", songId: "s1" });
    expect(mockDb.client.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cl1", orgId: "org-1" } })
    );
    expect(mockDb.folder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "f1", orgId: "org-1" } })
    );
    expect(mockDb.song.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1", orgId: "org-1", deletedAt: null } })
    );
  });

  it("reports the same field first when more than one is foreign", async () => {
    // Deterministic order, not whichever query resolved first — the same bad
    // request must not produce a different error message on a retry.
    mockDb.client.findFirst.mockResolvedValue(null);
    mockDb.folder.findFirst.mockResolvedValue(null);
    mockDb.song.findFirst.mockResolvedValue(null);
    for (let i = 0; i < 3; i += 1) {
      expect(await findForeignRef("org-1", { clientId: "x", folderId: "y", songId: "z" })).toBe("client");
    }
  });
});
