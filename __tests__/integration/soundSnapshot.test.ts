/**
 * @jest-environment node
 *
 * A 24-hour delta needs two readings. The first snapshot of a sound has no
 * predecessor, and the lifetime uses count is not a daily figure -- reporting it
 * as one told a brand that a sound trending for a month had gained all 46 of its
 * videos today.
 */
jest.mock("@/lib/db", () => ({
  db: {
    soundTrackerSnapshot: { create: jest.fn() },
    tikTokSound: { update: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import { recordSoundSnapshot, soundMetadataPatch } from "@/lib/sounds/snapshot";

const mockDb = db as unknown as {
  soundTrackerSnapshot: { create: jest.Mock };
  tikTokSound: { update: jest.Mock };
};

const sound = (snapshots: { usesCount: number }[]) => ({
  id: "sound-1",
  title: "Wherever I Go",
  artist: "Ellie Holcomb",
  coverImageUrl: "https://p77-sg.tiktokcdn.com/cover.jpeg",
  snapshots,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.soundTrackerSnapshot.create.mockResolvedValue({});
});

const written = () => mockDb.soundTrackerSnapshot.create.mock.calls[0][0].data;

it("invents no change on the first snapshot of a sound", async () => {
  await recordSoundSnapshot(sound([]), { usesCount: 46 });

  expect(written().usesCount).toBe(46);
  expect(written().videosAdded24h).toBe(0);
  expect(written().deltaUses24h).toBe(0);
  // Not 100: growth from an unobserved baseline is not growth we saw.
  expect(written().velocityScore).toBe(0);
});

it("diffs against the previous reading once there is one", async () => {
  await recordSoundSnapshot(sound([{ usesCount: 40 }]), { usesCount: 46 });

  expect(written().videosAdded24h).toBe(6);
  expect(written().deltaUses24h).toBe(6);
  expect(written().velocityScore).toBe(15);
});

it("records a drop without claiming videos were added", async () => {
  await recordSoundSnapshot(sound([{ usesCount: 50 }]), { usesCount: 46 });

  expect(written().videosAdded24h).toBe(0);
  expect(written().deltaUses24h).toBe(-4);
});

it("backfills only the metadata the operator left blank", async () => {
  await recordSoundSnapshot(
    { id: "s", title: null, artist: "Kept", coverImageUrl: null, snapshots: [] },
    { usesCount: 1, title: "Learned", artist: "Ignored", coverImageUrl: "https://x/c.jpg" },
  );

  expect(mockDb.tikTokSound.update.mock.calls[0][0].data).toEqual({
    title: "Learned",
    coverImageUrl: "https://x/c.jpg",
  });
});

it("skips the metadata write when there is nothing to learn", async () => {
  await recordSoundSnapshot(sound([]), { usesCount: 46 });
  expect(mockDb.tikTokSound.update).not.toHaveBeenCalled();
});

/* Cover art is a signed URL, not a name. Backfilling it once and never looking
   again is how a report loses its artwork months later with nothing reporting a
   failure -- while every reading hands back a freshly signed one for nothing. */
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const signed = (hoursFromNow: number) =>
  `https://p16-sign-sg.tiktokcdn.com/c.jpeg?x-expires=${
    Math.floor(NOW / 1000) + hoursFromNow * 3600
  }&x-signature=z`;

it("renews a cover whose signature is about to expire", () => {
  const patch = soundMetadataPatch(
    { title: "Roots", artist: "Jamie", coverImageUrl: signed(1) },
    { title: "Roots", artist: "Jamie", coverImageUrl: signed(72) },
    NOW,
  );
  expect(patch).toEqual({ coverImageUrl: signed(72) });
});

it("leaves a cover alone while its signature is still good", () => {
  const patch = soundMetadataPatch(
    { title: "Roots", artist: "Jamie", coverImageUrl: signed(48) },
    { title: "Roots", artist: "Jamie", coverImageUrl: signed(72) },
    NOW,
  );
  // Hourly readings would otherwise rewrite this row 24 times a day for nothing.
  expect(patch).toEqual({});
});

it("never overwrites a title or artist the operator typed", () => {
  const patch = soundMetadataPatch(
    { title: "Ours", artist: "Ours", coverImageUrl: null },
    { title: "Theirs", artist: "Theirs", coverImageUrl: null },
    NOW,
  );
  expect(patch).toEqual({});
});
