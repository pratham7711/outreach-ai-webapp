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
    // Read twice per request: once here for chart granularity, once inside
    // getOrgEntitlements for the tracker limit.
    organization: { findUnique: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { orgFixture } from "../helpers/orgFixture";

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

  it("returns 403 when sound not in org", async () => {
    mockDb.tikTokSound.findFirst.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/trackers/sound-1");
    const res = await getTrackerDetail(req, makeParams("sound-1"));
    expect(res.status).toBe(403);
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

  it("returns 403 when sound not in org", async () => {
    mockDb.tikTokSound.findFirst.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/trackers/sound-1", {
      method: "DELETE",
    });
    const res = await deleteTracker(req, makeParams("sound-1"));
    expect(res.status).toBe(403);
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
