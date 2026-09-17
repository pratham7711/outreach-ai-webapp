/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import {
  GET as getTrackers,
  POST as postTracker,
} from "@/app/api/trackers/route";
import {
  GET as getTrackerDetail,
  DELETE as deleteTracker,
} from "@/app/api/trackers/[id]/route";

jest.mock("@/lib/db", () => ({
  db: {
    tikTokSound: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    soundTrackerSnapshot: {
      deleteMany: jest.fn(),
    },
    // The plan limit counts sounds AND tracked creators against one
    // max_trackers — see lib/trackers/limit.
    creator: { count: jest.fn() },
    // Read twice per request: once here for chart granularity, once inside
    // getOrgEntitlements for the tracker limit.
    organization: { findUnique: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

/* The add path reads the real Instagram audio page for an Instagram link. The
   unit tests cover the parser against captured HTML; here the reader is mocked
   so these assert the route's behaviour rather than Instagram's availability. */
jest.mock("@/lib/platforms/instagramAudioUsage", () => ({
  readOneInstagramAudio: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { orgFixture } from "../helpers/orgFixture";
import { readOneInstagramAudio as readOneInstagramAudioImpl } from "@/lib/platforms/instagramAudioUsage";

const readOneInstagramAudio = readOneInstagramAudioImpl as jest.Mock;

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.organization.findUnique.mockResolvedValue(orgFixture());
  mockDb.tikTokSound.count.mockResolvedValue(0);
  mockDb.creator.count.mockResolvedValue(0);
});

// ─── GET /api/trackers ──────────────────────────────────────────────────────

describe("GET /api/trackers", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/trackers");
    const res = await getTrackers(req);
    expect(res.status).toBe(401);
  });

  it("computes trending from two snapshots inside the window", async () => {
    // 500 uses added over 10 hours is 50/hour, which is trending (>=10, <100).
    const now = Date.now();
    mockDb.tikTokSound.findMany.mockResolvedValue([
      {
        id: "sound-1",
        orgId: "org-1",
        tiktokSoundId: "tt-123",
        title: "Hit Song",
        artist: "Artist A",
        coverImageUrl: null,
        trackedSince: new Date(),
        createdAt: new Date(),
        snapshots: [
          { id: "snap-2", soundId: "sound-1", usesCount: 10500, videosAdded24h: 500, deltaUses24h: 500, velocityScore: 5, recordedAt: new Date(now) },
          { id: "snap-1", soundId: "sound-1", usesCount: 10000, videosAdded24h: 0, deltaUses24h: 0, velocityScore: 0, recordedAt: new Date(now - 10 * 60 * 60 * 1000) },
        ],
      },
    ]);

    const res = await getTrackers(makeRequest("http://localhost/api/trackers"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sounds).toHaveLength(1);
    expect(body.sounds[0].status).toBe("trending");
    expect(body.sounds[0].growthPercentage).toBeCloseTo(5, 5);
    expect(body.sounds[0].addedInPeriod).toBe(500);
    expect(body.sounds[0].latestSnapshot).toBeTruthy();
  });

  it("reports unknown from a single snapshot, because change needs two points", async () => {
    // The tracker exists and has been measured once. That says nothing about
    // whether it is climbing, so status must not guess -- the old behaviour read
    // velocityScore off the one row and called a lone reading "trending".
    mockDb.tikTokSound.findMany.mockResolvedValue([
      {
        id: "sound-1",
        orgId: "org-1",
        tiktokSoundId: "tt-123",
        title: "Hit Song",
        artist: "Artist A",
        coverImageUrl: null,
        trackedSince: new Date(),
        createdAt: new Date(),
        snapshots: [
          { id: "snap-1", soundId: "sound-1", usesCount: 10000, videosAdded24h: 500, deltaUses24h: 500, velocityScore: 75, recordedAt: new Date() },
        ],
      },
    ]);

    const res = await getTrackers(makeRequest("http://localhost/api/trackers"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sounds[0].status).toBe("unknown");
    expect(body.sounds[0].growthPercentage).toBeNull();
    // The reading itself is still surfaced; only the trend claim is withheld.
    expect(body.sounds[0].latestSnapshot).toBeTruthy();
  });

  it("reports unknown when there are no snapshots at all", async () => {
    mockDb.tikTokSound.findMany.mockResolvedValue([
      {
        id: "sound-2",
        orgId: "org-1",
        tiktokSoundId: "tt-456",
        title: "New Track",
        artist: "Artist B",
        coverImageUrl: null,
        trackedSince: new Date(),
        createdAt: new Date(),
        snapshots: [],
      },
    ]);

    const res = await getTrackers(makeRequest("http://localhost/api/trackers"));
    const body = await res.json();

    expect(body.sounds[0].status).toBe("unknown");
    expect(body.sounds[0].growthPercentage).toBeNull();
    expect(body.sounds[0].latestSnapshot).toBeNull();
  });
});

// ─── POST /api/trackers ─────────────────────────────────────────────────────

describe("POST /api/trackers", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/trackers", {
      method: "POST",
      body: JSON.stringify({ tiktokSoundId: "tt-1", title: "T", artist: "A" }),
    });
    const res = await postTracker(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body", async () => {
    const req = makeRequest("http://localhost/api/trackers", {
      method: "POST",
      body: JSON.stringify({ title: "T" }),
    });
    const res = await postTracker(req);
    expect(res.status).toBe(400);
  });

  /**
   * Instagram audio is admitted, but only after the page has been read.
   *
   * The blanket refusal these tests used to assert was right while no reader
   * existed. Now one does, and the question moved: an audio page can be a 200
   * and still be untrackable, so the route probes it. Every case below is a 200
   * from Instagram -- that is precisely why they have to be distinguished
   * rather than assumed.
   */
  describe("adding Instagram audio", () => {
    const igUrl = "https://www.instagram.com/reels/audio/2094289147512017/";

    it("creates the tracker, naming it from the page rather than the link", async () => {
      readOneInstagramAudio.mockResolvedValue({
        ok: true,
        reading: {
          usesCount: 1_000_000,
          precision: "rounded",
          title: "Runaway",
          artist: "AURORA",
          coverImageUrl: "https://scontent.cdninstagram.com/cover.jpg",
        },
      });
      mockDb.tikTokSound.findFirst.mockResolvedValue(null);
      mockDb.tikTokSound.create.mockResolvedValue({
        id: "sound-ig-1",
        orgId: "org-1",
        platform: "INSTAGRAM",
        tiktokSoundId: "2094289147512017",
        title: "Runaway",
        artist: "AURORA",
        coverImageUrl: "https://scontent.cdninstagram.com/cover.jpg",
      });

      const res = await postTracker(
        makeRequest("http://localhost/api/trackers", { method: "POST", body: JSON.stringify({ url: igUrl }) }),
      );

      expect(res.status).toBe(201);
      expect(mockDb.tikTokSound.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            platform: "INSTAGRAM",
            tiktokSoundId: "2094289147512017",
            title: "Runaway",
            artist: "AURORA",
          }),
        }),
      );
    });

    /* A fabricated id returns Instagram's generic audio shell with a 200. */
    it("refuses an audio that does not exist, despite the 200", async () => {
      readOneInstagramAudio.mockResolvedValue({ ok: false, reason: "not-found" });
      mockDb.tikTokSound.findFirst.mockResolvedValue(null);

      const res = await postTracker(
        makeRequest("http://localhost/api/trackers", { method: "POST", body: JSON.stringify({ url: igUrl }) }),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("instagram_audio_not_found");
      expect(mockDb.tikTokSound.create).not.toHaveBeenCalled();
    });

    /* Original audio exists and is in use; Instagram just never says by how
       many. Tracking it would park a row that can never produce a number --
       the exact failure the old blanket refusal was protecting against. */
    it("refuses audio that publishes no use count", async () => {
      readOneInstagramAudio.mockResolvedValue({ ok: false, reason: "no-count" });
      mockDb.tikTokSound.findFirst.mockResolvedValue(null);

      const res = await postTracker(
        makeRequest("http://localhost/api/trackers", { method: "POST", body: JSON.stringify({ url: igUrl }) }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("instagram_audio_no_count");
      expect(body.message).toMatch(/doesn't publish a use count/);
      expect(mockDb.tikTokSound.create).not.toHaveBeenCalled();
    });

    /* Not reaching Instagram is our problem, not the link's, so it is a 422
       and the copy invites a retry rather than telling them the audio is bad. */
    it("answers 422 when Instagram could not be reached", async () => {
      readOneInstagramAudio.mockResolvedValue({ ok: false, reason: "fetch-failed" });
      mockDb.tikTokSound.findFirst.mockResolvedValue(null);

      const res = await postTracker(
        makeRequest("http://localhost/api/trackers", { method: "POST", body: JSON.stringify({ url: igUrl }) }),
      );

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("instagram_audio_unreadable");
      expect(mockDb.tikTokSound.create).not.toHaveBeenCalled();
    });

    /* The TikTok path must not have grown a network call: it does not fetch,
       and making the common case pay for the rare one is the regression. */
    it("does not probe Instagram for a TikTok link", async () => {
      mockDb.tikTokSound.findFirst.mockResolvedValue(null);

      await postTracker(
        makeRequest("http://localhost/api/trackers", {
          method: "POST",
          body: JSON.stringify({ url: "https://www.tiktok.com/music/Roots-7678797827745155089" }),
        }),
      );

      expect(readOneInstagramAudio).not.toHaveBeenCalled();
    });
  });

  /* The free tier allows 0 trackers, and 0 is exactly the value a falsy check
     swallows. If `?? Infinity` ever becomes `|| Infinity`, or the gate becomes
     `if (maxTrackers)`, the free tier silently turns unlimited and these are
     the only tests that would notice. */
  describe("a plan with no trackers at all", () => {
    const freeOrg = () => {
      mockDb.organization.findUnique.mockResolvedValue(orgFixture({ plan: "free" }));
      mockDb.tikTokSound.findFirst.mockResolvedValue(null);
      mockDb.tikTokSound.count.mockResolvedValue(0);
  mockDb.creator.count.mockResolvedValue(0);
    };

    it("refuses the very first tracker", async () => {
      freeOrg();

      const req = makeRequest("http://localhost/api/trackers", {
        method: "POST",
        body: JSON.stringify({
          tiktokSoundId: "7546394810303694849",
          title: "New Sound",
          artist: "New Artist",
        }),
      });
      const res = await postTracker(req);

      expect(res.status).toBe(409);
      expect(mockDb.tikTokSound.create).not.toHaveBeenCalled();
    });

    /* "Remove one to make room" is nonsense advice to somebody who has none,
       and it does not say what would actually help. */
    it("says the plan excludes trackers rather than telling you to remove one", async () => {
      freeOrg();

      const req = makeRequest("http://localhost/api/trackers", {
        method: "POST",
        body: JSON.stringify({
          tiktokSoundId: "7546394810303694849",
          title: "New Sound",
          artist: "New Artist",
        }),
      });
      const body = await (await postTracker(req)).json();

      expect(body.error).toBe(
        "Your plan does not include trackers. Upgrade to start tracking sounds."
      );
      expect(body.error).not.toContain("Remove one");
      expect(body.trackers).toEqual({ used: 0, max: 0 });
    });

    /* null means unlimited on this wire (Infinity does not survive JSON), so a
       0 that arrives as null would render as "no counter, add away". */
    it("sends 0 rather than null on the listing, so the UI can tell them apart", async () => {
      mockDb.organization.findUnique.mockResolvedValue(orgFixture({ plan: "free" }));
      mockDb.tikTokSound.findMany.mockResolvedValue([]);

      const res = await getTrackers(makeRequest("http://localhost/api/trackers"));
      const body = await res.json();

      expect(body.limits).toEqual({ used: 0, max: 0 });
      expect(body.limits.max).not.toBeNull();
    });
  });

  it("creates a tracked sound", async () => {
    /* A real TikTok sound id: the route requires 18-20 digits, deliberately, so
       a typo or a video id is refused before it becomes a tracker that can
       never be read. The old "tt-999" placeholder predates that rule. */
    const created = {
      id: "sound-new",
      orgId: "org-1",
      tiktokSoundId: "7546394810303694849",
      title: "New Sound",
      artist: "New Artist",
      coverImageUrl: null,
      trackedSince: new Date(),
      createdAt: new Date(),
    };
    mockDb.tikTokSound.create.mockResolvedValue(created);

    const req = makeRequest("http://localhost/api/trackers", {
      method: "POST",
      body: JSON.stringify({
        tiktokSoundId: "7546394810303694849",
        title: "New Sound",
        artist: "New Artist",
      }),
    });
    const res = await postTracker(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.tiktokSoundId).toBe("7546394810303694849");
    expect(mockDb.tikTokSound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        tiktokSoundId: "7546394810303694849",
        title: "New Sound",
        artist: "New Artist",
        coverImageUrl: null,
      }),
    });
  });
});

// ─── GET /api/trackers/[id] ─────────────────────────────────────────────────

describe("GET /api/trackers/[id]", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/trackers/sound-1");
    const res = await getTrackerDetail(req, makeParams("sound-1"));
    expect(res.status).toBe(401);
  });

  /* 404, not 403. The query is scoped to the org, so a miss is either "no such
     tracker" or "not yours" — and 403 tells a stranger the id exists somewhere
     while reading, to the owner, like a permissions bug. */
  it("returns 404 when sound not in org", async () => {
    mockDb.tikTokSound.findFirst.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/trackers/sound-1");
    const res = await getTrackerDetail(req, makeParams("sound-1"));
    expect(res.status).toBe(404);
  });

  it("returns sound detail with all snapshots", async () => {
    const sound = {
      id: "sound-1",
      orgId: "org-1",
      tiktokSoundId: "tt-123",
      title: "Hit Song",
      artist: "Artist A",
      coverImageUrl: null,
      trackedSince: new Date(),
      createdAt: new Date(),
      snapshots: [
        {
          id: "snap-1",
          soundId: "sound-1",
          usesCount: 5000,
          velocityScore: 30,
          recordedAt: new Date("2026-03-28"),
        },
        {
          id: "snap-2",
          soundId: "sound-1",
          usesCount: 10000,
          velocityScore: 75,
          recordedAt: new Date("2026-03-29"),
        },
      ],
    };
    mockDb.tikTokSound.findFirst.mockResolvedValue(sound);

    const req = makeRequest("http://localhost/api/trackers/sound-1");
    const res = await getTrackerDetail(req, makeParams("sound-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("sound-1");
    expect(body.snapshots).toHaveLength(2);
  });
});

// ─── DELETE /api/trackers/[id] ──────────────────────────────────────────────

describe("DELETE /api/trackers/[id]", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/trackers/sound-1", {
      method: "DELETE",
    });
    const res = await deleteTracker(req, makeParams("sound-1"));
    expect(res.status).toBe(401);
  });

  /* 404, not 403. The query is scoped to the org, so a miss is either "no such
     tracker" or "not yours" — and 403 tells a stranger the id exists somewhere
     while reading, to the owner, like a permissions bug. */
  it("returns 404 when sound not in org", async () => {
    mockDb.tikTokSound.findFirst.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/trackers/sound-1", {
      method: "DELETE",
    });
    const res = await deleteTracker(req, makeParams("sound-1"));
    expect(res.status).toBe(404);
  });

  it("deletes sound and its snapshots", async () => {
    mockDb.tikTokSound.findFirst.mockResolvedValue({
      id: "sound-1",
      orgId: "org-1",
    });
    mockDb.soundTrackerSnapshot.deleteMany.mockResolvedValue({ count: 3 });
    mockDb.tikTokSound.delete.mockResolvedValue({ id: "sound-1" });

    const req = makeRequest("http://localhost/api/trackers/sound-1", {
      method: "DELETE",
    });
    const res = await deleteTracker(req, makeParams("sound-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(mockDb.soundTrackerSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { soundId: "sound-1" },
    });
    expect(mockDb.tikTokSound.delete).toHaveBeenCalledWith({
      where: { id: "sound-1" },
    });
  });
});
