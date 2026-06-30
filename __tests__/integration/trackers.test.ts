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
    },
    soundTrackerSnapshot: {
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

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
});

// ─── GET /api/trackers ──────────────────────────────────────────────────────

describe("GET /api/trackers", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/trackers");
    const res = await getTrackers(req);
    expect(res.status).toBe(401);
  });

  it("returns sounds with computed status and growth", async () => {
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
          {
            id: "snap-1",
            soundId: "sound-1",
            usesCount: 10000,
            videosAdded24h: 500,
            deltaUses24h: 500,
            velocityScore: 75,
            recordedAt: new Date(),
          },
        ],
      },
    ]);

    const req = makeRequest("http://localhost/api/trackers");
    const res = await getTrackers(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sounds).toHaveLength(1);
    expect(body.sounds[0].status).toBe("trending");
    expect(body.sounds[0].growthPercentage).toBeGreaterThan(0);
    expect(body.sounds[0].latestSnapshot).toBeTruthy();
  });

  it("returns stable status when no snapshots", async () => {
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

    const req = makeRequest("http://localhost/api/trackers");
    const res = await getTrackers(req);
    const body = await res.json();

    expect(body.sounds[0].status).toBe("stable");
    expect(body.sounds[0].growthPercentage).toBe(0);
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
    const created = {
      id: "sound-new",
      orgId: "org-1",
      tiktokSoundId: "tt-999",
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
        tiktokSoundId: "tt-999",
        title: "New Sound",
        artist: "New Artist",
      }),
    });
    const res = await postTracker(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.tiktokSoundId).toBe("tt-999");
    expect(mockDb.tikTokSound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        tiktokSoundId: "tt-999",
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
