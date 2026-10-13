/**
 * @jest-environment node
 *
 * The connected account's stored figures through the shared validation gate
 * (plan A3). The connected follower count outranks every public read of the
 * creator (lib/creators/connectedReading), so a bad one written here travels to
 * the roster; these pin that it is not written, and that real ones are.
 */
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    creatorSocialAccount: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
  },
}));

import { persistAccountIdentity, type AccountIdentity } from "@/lib/platforms/accountSync";

const identity = (over: Partial<AccountIdentity> = {}): AccountIdentity =>
  ({
    platformUserId: "17841400000000001",
    handle: "blessing.jolie",
    avatarUrl: null,
    bio: null,
    profileUrl: null,
    isVerified: false,
    followersCount: 48_210,
    followingCount: 310,
    mediaCount: 212,
    totalLikes: null,
    ...over,
  }) as AccountIdentity;

const stored = {
  followersCount: 48_000,
  platform: "INSTAGRAM",
  platformUserId: "17841400000000001",
  mediaCount: 210,
  totalLikes: null,
};

beforeEach(() => {
  mockFindUnique.mockReset().mockResolvedValue(stored);
  mockUpdate.mockReset().mockResolvedValue({});
  jest.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

const written = () => mockUpdate.mock.calls[0][0].data;

it("writes a consistent reading", async () => {
  expect(await persistAccountIdentity("acc-1", identity(), "INSTAGRAM")).toBe(true);
  expect(written()).toMatchObject({ followersCount: 48_210, mediaCount: 212 });
});

it("refuses followers falling to 0 and writes nothing, not even the sync time", async () => {
  expect(await persistAccountIdentity("acc-1", identity({ followersCount: 0, mediaCount: 0 }), "INSTAGRAM")).toBe(false);
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("refuses a reading of a different account than the row is bound to", async () => {
  expect(
    await persistAccountIdentity("acc-1", identity({ platformUserId: "17841400000000999" }), "INSTAGRAM"),
  ).toBe(false);
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("refuses a reading for another platform than the row's", async () => {
  expect(await persistAccountIdentity("acc-1", identity(), "TIKTOK")).toBe(false);
});

it("leaves a media count that fell to 0 out and writes the rest", async () => {
  expect(await persistAccountIdentity("acc-1", identity({ mediaCount: 0 }), "INSTAGRAM")).toBe(true);
  expect(written()).not.toHaveProperty("mediaCount");
  expect(written()).toMatchObject({ followersCount: 48_210 });
});

it("writes a real drop in followers, and a row with nothing bound yet", async () => {
  mockFindUnique.mockResolvedValue({ ...stored, platformUserId: null });
  expect(await persistAccountIdentity("acc-1", identity({ followersCount: 31_000 }), "INSTAGRAM")).toBe(true);
  expect(written()).toMatchObject({ followersCount: 31_000 });
});
