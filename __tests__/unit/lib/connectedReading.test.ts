/**
 * @jest-environment node
 *
 * The creator's own connection as a follower-count candidate (plan A7, A8):
 * through the grant gate, never a manual or dev row, only the tracked
 * account, and only a reading newer than the last snapshot.
 */
jest.mock("@/lib/creators/connectionGate", () => ({ connectionForRead: jest.fn() }));

import { connectionForRead } from "@/lib/creators/connectionGate";
import { connectedFollowerReading } from "@/lib/creators/connectedReading";

const mockGate = connectionForRead as jest.Mock;
const SYNCED = new Date("2026-10-01T10:00:00Z");
const creator = { id: "creator-1", orgId: "org-a", platform: "TIKTOK", handle: "@fake_tracked", platformUserId: "open-id-fake" };

beforeEach(() => {
  jest.clearAllMocks();
  mockGate.mockResolvedValue({
    ok: true,
    grantId: "g-1",
    connection: { id: "conn-1", followersCount: 1234, statsSyncedAt: SYNCED },
  });
});

it("offers the connection's figure, measured when the connection last synced", async () => {
  expect(await connectedFollowerReading(creator, null)).toEqual({ source: "connected", value: 1234, measuredAt: SYNCED });
});

it("asks the gate for this org, and only for real connections of the same account", async () => {
  await connectedFollowerReading(creator, null);
  const [orgId, creatorId, platform, filter] = mockGate.mock.calls[0];
  expect([orgId, creatorId, platform]).toEqual(["org-a", "creator-1", "TIKTOK"]);
  expect(filter.where.statsSyncedAt).toEqual({ not: null });
  expect(filter.where.AND[0]).toEqual({ OR: [{ origin: null }, { origin: { notIn: ["manual", "dev"] } }] });
  expect(filter.where.AND[1].OR).toEqual([
    { platformUserId: "open-id-fake" },
    { handle: { equals: "fake_tracked", mode: "insensitive" } },
    { handle: { equals: "@fake_tracked", mode: "insensitive" } },
  ]);
});

it("offers nothing without a grant", async () => {
  mockGate.mockResolvedValue({ ok: false, unknown: "no_grant" });
  expect(await connectedFollowerReading(creator, null)).toBeNull();
});

it("offers nothing that the previous snapshot could already have recorded", async () => {
  expect(await connectedFollowerReading(creator, new Date(SYNCED.getTime() + 1))).toBeNull();
  expect(await connectedFollowerReading(creator, SYNCED)).toBeNull();
  expect(await connectedFollowerReading(creator, new Date(SYNCED.getTime() - 1))).not.toBeNull();
});

it("never throws", async () => {
  mockGate.mockRejectedValue(new Error("db down"));
  expect(await connectedFollowerReading(creator, null)).toBeNull();
});
