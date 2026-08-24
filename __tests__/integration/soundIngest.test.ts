/**
 * @jest-environment node
 *
 * The audio tracker's way in from the VPS that can actually read a TikTok music
 * page. Two things have to hold, and neither is about the happy path.
 *
 * It is an authenticated write endpoint reachable from the open internet, so the
 * door is the first thing tested. And it must never become a second copy of the
 * snapshot arithmetic -- recordSoundSnapshot owns the delta, the velocity and
 * the metadata backfill, and the last time that logic was duplicated a sound
 * with 46 uses reported "+100 videos added" on a client's report.
 */
jest.mock("@/lib/db", () => ({
  db: {
    tikTokSound: { findMany: jest.fn(), update: jest.fn() },
    soundTrackerSnapshot: { create: jest.fn() },
  },
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/trackers/sounds/ingest/route";

const mockDb = db as unknown as {
  tikTokSound: { findMany: jest.Mock; update: jest.Mock };
  soundTrackerSnapshot: { create: jest.Mock };
};

const TOKEN = "test-ingest-token";
const URL = "http://localhost:3009/api/trackers/sounds/ingest";

function post(body: unknown, token: string | null = TOKEN) {
  return new NextRequest(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const TRACKED = {
  id: "sound-1",
  tiktokSoundId: "7546394810303694849",
  title: null,
  artist: null,
  coverImageUrl: null,
  snapshots: [{ usesCount: 40 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOUND_INGEST_TOKEN = TOKEN;
  mockDb.tikTokSound.findMany.mockResolvedValue([TRACKED]);
  mockDb.soundTrackerSnapshot.create.mockResolvedValue({});
  mockDb.tikTokSound.update.mockResolvedValue({});
});

afterAll(() => {
  delete process.env.SOUND_INGEST_TOKEN;
});

describe("the door", () => {
  it("refuses a request with no token, before it reads anything", async () => {
    const res = await POST(post({ readings: [{ tiktokSoundId: "x", usesCount: 1 }] }, null));
    expect(res.status).toBe(401);
    expect(mockDb.tikTokSound.findMany).not.toHaveBeenCalled();
  });

  it("refuses the wrong token", async () => {
    const res = await POST(post({ readings: [{ tiktokSoundId: "x", usesCount: 1 }] }, "not-it"));
    expect(res.status).toBe(401);
    expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
  });

  it("refuses everything when no token is configured at all", async () => {
    /* Otherwise an environment that simply forgot to set one would accept
       "Bearer undefined" from anybody. */
    delete process.env.SOUND_INGEST_TOKEN;
    const cron = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await POST(post({ readings: [{ tiktokSoundId: "x", usesCount: 1 }] }, "undefined"));
      expect(res.status).toBe(401);
    } finally {
      process.env.SOUND_INGEST_TOKEN = TOKEN;
      if (cron !== undefined) process.env.CRON_SECRET = cron;
    }
  });

  it("hands the worker only the ids it needs to do its job", async () => {
    mockDb.tikTokSound.findMany.mockResolvedValue([
      { id: "sound-1", tiktokSoundId: "7546394810303694849", title: "Wherever I Go" },
    ]);
    const res = await GET(new NextRequest(URL, { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sounds: [{ id: "sound-1", tiktokSoundId: "7546394810303694849", title: "Wherever I Go" }],
    });
  });
});

describe("what it does with a reading", () => {
  it("records one, with the delta measured against the previous snapshot", async () => {
    const res = await POST(post({ readings: [{ tiktokSoundId: TRACKED.tiktokSoundId, usesCount: 45 }] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recorded: 1, unknown: 0, skipped: 0 });

    const written = mockDb.soundTrackerSnapshot.create.mock.calls[0][0].data;
    expect(written.usesCount).toBe(45);
    // 45 against a stored 40: the endpoint does not compute this, the shared
    // function does, and that is exactly the point of the assertion.
    expect(written.videosAdded24h).toBe(5);
    expect(written.deltaUses24h).toBe(5);
  });

  it("backfills a title and cover the operator never filled in", async () => {
    await POST(
      post({
        readings: [
          {
            tiktokSoundId: TRACKED.tiktokSoundId,
            usesCount: 45,
            title: "Wherever I Go",
            artist: "Ellie Holcomb",
            coverImageUrl: "https://p16-common-sign.tiktokcdn.com/cover.jpeg",
          },
        ],
      })
    );
    expect(mockDb.tikTokSound.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Wherever I Go", artist: "Ellie Holcomb" }),
      })
    );
  });

  it("writes nothing for a zero, which is what an unreadable page parses to", async () => {
    const res = await POST(post({ readings: [{ tiktokSoundId: TRACKED.tiktokSoundId, usesCount: 0 }] }));
    expect(await res.json()).toMatchObject({ recorded: 0, skipped: 1 });
    // A stored zero would draw a cliff on the campaign's audio chart.
    expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
  });

  it("ignores a sound that stopped being tracked while the worker was reading", async () => {
    mockDb.tikTokSound.findMany.mockResolvedValue([]);
    const res = await POST(post({ readings: [{ tiktokSoundId: "7300009", usesCount: 12 }] }));
    expect(await res.json()).toMatchObject({ recorded: 0, unknown: 1 });
    expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
  });

  it("reads every page but writes none on a dry run", async () => {
    const res = await POST(post({ readings: [{ tiktokSoundId: TRACKED.tiktokSoundId, usesCount: 45 }], dryRun: true }));
    expect(await res.json()).toMatchObject({ recorded: 1, dryRun: true });
    expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
  });
});

describe("bodies it should not accept", () => {
  it.each([
    ["no readings at all", { readings: [] }],
    ["a count that is not a number", { readings: [{ tiktokSoundId: "x", usesCount: "45" }] }],
    ["a negative count", { readings: [{ tiktokSoundId: "x", usesCount: -1 }] }],
    ["a missing sound id", { readings: [{ usesCount: 45 }] }],
    ["more than one batch could plausibly hold", { readings: Array.from({ length: 201 }, () => ({ tiktokSoundId: "x", usesCount: 1 })) }],
  ])("rejects %s", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON without throwing", async () => {
    const res = await POST(post("not json at all"));
    expect(res.status).toBe(400);
  });
});
