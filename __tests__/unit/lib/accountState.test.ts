/**
 * @jest-environment node
 *
 * CreatorAccountState is read and written only behind its ready-check, and a
 * missing table or a failed query reads as "nothing recorded" — the state
 * every connection was in before the table existed. And a "Reconnect needed"
 * mark is a mark: it never touches the account row.
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorAccountState: { findMany: jest.fn(), upsert: jest.fn() },
    creatorSocialAccount: { delete: jest.fn(), deleteMany: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/creators/connectTables", () => ({ connectTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { connectTablesReady } from "@/lib/creators/connectTables";
import {
  accountIdsForGrantor,
  accountStatesFor,
  isReconnectNeeded,
  markReconnectNeeded,
  recordConnectionState,
} from "@/lib/platforms/accountState";

const mockDb = db as unknown as {
  creatorAccountState: { findMany: jest.Mock; upsert: jest.Mock };
  creatorSocialAccount: { delete: jest.Mock; deleteMany: jest.Mock; update: jest.Mock };
};
const mockReady = connectTablesReady as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockReady.mockResolvedValue(true);
  mockDb.creatorAccountState.findMany.mockResolvedValue([]);
  mockDb.creatorAccountState.upsert.mockResolvedValue({});
});

describe("without the table", () => {
  beforeEach(() => mockReady.mockResolvedValue(false));

  it("reads as nothing recorded and queries nothing", async () => {
    expect((await accountStatesFor(["a"])).size).toBe(0);
    expect(await isReconnectNeeded("a")).toBe(false);
    expect(await accountIdsForGrantor("fb-1")).toEqual([]);
    expect(mockDb.creatorAccountState.findMany).not.toHaveBeenCalled();
  });

  it("writes nothing and says so", async () => {
    expect(await markReconnectNeeded("a", "invalid_grant")).toBe(false);
    await recordConnectionState("a", { grantorUserId: "fb-1" });
    expect(mockDb.creatorAccountState.upsert).not.toHaveBeenCalled();
  });
});

describe("with the table", () => {
  it("marks Reconnect needed on the state row only", async () => {
    expect(await markReconnectNeeded("sa-1", "invalid_grant")).toBe(true);
    const args = mockDb.creatorAccountState.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ accountId: "sa-1" });
    expect(args.update.reconnectReason).toBe("invalid_grant");
    expect(args.update.reconnectNeededAt).toBeInstanceOf(Date);
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.deleteMany).not.toHaveBeenCalled();
    expect(mockDb.creatorSocialAccount.update).not.toHaveBeenCalled();
  });

  it("a fresh consent clears the mark and keeps a grantor it could not re-read", async () => {
    await recordConnectionState("sa-1", { grantorUserId: undefined, displayName: "Fake Name" });
    const { update } = mockDb.creatorAccountState.upsert.mock.calls[0][0];
    expect(update).toEqual({ displayName: "Fake Name", reconnectNeededAt: null, reconnectReason: null });
    expect("grantorUserId" in update).toBe(false);
  });

  it("reports the mark back", async () => {
    mockDb.creatorAccountState.findMany.mockResolvedValue([
      { accountId: "sa-1", grantorUserId: null, reconnectNeededAt: new Date(), reconnectReason: "invalid_grant", displayName: null },
    ]);
    expect(await isReconnectNeeded("sa-1")).toBe(true);
  });

  it("degrades to nothing recorded when the query fails", async () => {
    mockDb.creatorAccountState.findMany.mockRejectedValue(new Error("boom"));
    expect((await accountStatesFor(["sa-1"])).size).toBe(0);
    expect(await accountIdsForGrantor("fb-1")).toEqual([]);
    mockDb.creatorAccountState.upsert.mockRejectedValue(new Error("boom"));
    expect(await markReconnectNeeded("sa-1", "invalid_grant")).toBe(false);
  });
});
