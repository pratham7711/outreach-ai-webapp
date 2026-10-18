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

jest.mock("@/lib/sounds/coverStore", () => ({ captureSoundCover: jest.fn().mockResolvedValue(true) }));

import { db } from "@/lib/db";
import { captureSoundCover } from "@/lib/sounds/coverStore";
import { recordSoundSnapshot, soundMetadataPatch } from "@/lib/sounds/snapshot";

const mockCapture = captureSoundCover as jest.Mock;

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

/* lib/sounds/precision. Production, 2026-10-03: a TikTok sound near 74K was
   read 33 times, every reading a multiple of 100 (the embed's "73.9K"), and the
   writer stored the wobble between roundings as +100, +400, +300 videos. */
describe("rounded figures", () => {
  it("records a rounded level but no change from it", async () => {
    expect(await recordSoundSnapshot(sound([{ usesCount: 73_500 }]), { usesCount: 73_900 })).toBe(true);

    expect(written().usesCount).toBe(73_900);
    expect(written().videosAdded24h).toBe(0);
    expect(written().deltaUses24h).toBe(0);
    expect(written().velocityScore).toBe(0);
  });

  it("records no change across an exact reading and a rounded one", async () => {
    await recordSoundSnapshot(sound([{ usesCount: 8_659 }]), { usesCount: 12_000 }, { precision: "rounded" });

    expect(written().usesCount).toBe(12_000);
    expect(written().videosAdded24h).toBe(0);
  });

  it("does not put a rounded figure in place of the exact count it agrees with", async () => {
    expect(await recordSoundSnapshot(sound([{ usesCount: 73_912 }]), { usesCount: 74_000 })).toBe(false);

    expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
  });

  it("writes a rounded figure that has moved past the exact count", async () => {
    expect(await recordSoundSnapshot(sound([{ usesCount: 73_912 }]), { usesCount: 74_100 })).toBe(true);

    expect(written().usesCount).toBe(74_100);
    expect(written().videosAdded24h).toBe(0);
  });

  it("takes a reader's word that its figure is exact", async () => {
    await recordSoundSnapshot(sound([{ usesCount: 11_987 }]), { usesCount: 12_000 }, { precision: "exact" });

    expect(written().videosAdded24h).toBe(13);
  });
});

/* The cover used to be renewed only after a snapshot was written, so a
   reading that wrote none -- a rounded figure agreeing with the exact count
   already stored -- left a signed link to die. A cover is not a count, and the
   artwork no longer waits for one. */
describe("artwork on a reading that writes no snapshot", () => {
  const expiring = (hoursFromNow: number) =>
    `https://p16-sign-sg.tiktokcdn.com/c.jpeg?x-expires=${Math.floor(Date.now() / 1000) + hoursFromNow * 3600}&x-signature=z`;

  it("renews the link and keeps a copy even when the rounded figure adds nothing", async () => {
    const fresh = expiring(72);
    const written = await recordSoundSnapshot(
      { id: "sound-1", title: "T", artist: "A", coverImageUrl: expiring(-24), snapshots: [{ usesCount: 263_312 }] },
      { usesCount: 263_300, coverImageUrl: fresh },
    );

    expect(written).toBe(false);
    expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
    expect(mockDb.tikTokSound.update).toHaveBeenCalledWith({ where: { id: "sound-1" }, data: { coverImageUrl: fresh } });
    expect(mockCapture).toHaveBeenCalledWith("sound-1", fresh, expect.any(Number));
  });

  it("copies the stored link when the reading brought no cover and the link still works", async () => {
    const live = expiring(48);
    await recordSoundSnapshot(
      { id: "sound-1", title: "T", artist: "A", coverImageUrl: live, snapshots: [{ usesCount: 10 }] },
      { usesCount: 12, coverImageUrl: null },
    );
    expect(mockCapture).toHaveBeenCalledWith("sound-1", live, expect.any(Number));
  });

  it("keeps nothing from a reading the gate refused", async () => {
    // A fall to 0 from a real count is a reader that could not see the page.
    await recordSoundSnapshot(
      { id: "sound-1", title: "T", artist: "A", coverImageUrl: null, snapshots: [{ usesCount: 5_000 }] },
      { usesCount: 0, coverImageUrl: expiring(72) },
    );
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockDb.tikTokSound.update).not.toHaveBeenCalled();
  });

  it("still writes the snapshot when the metadata write fails", async () => {
    mockDb.tikTokSound.update.mockRejectedValueOnce(new Error("deadlock detected"));
    const written = await recordSoundSnapshot(
      { id: "sound-1", title: null, artist: "A", coverImageUrl: null, snapshots: [{ usesCount: 10 }] },
      { usesCount: 12, title: "Learned" },
    );
    expect(written).toBe(true);
    expect(mockDb.soundTrackerSnapshot.create).toHaveBeenCalledTimes(1);
  });
});
