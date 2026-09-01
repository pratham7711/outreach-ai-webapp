/**
 * @jest-environment node
 *
 * The creator tracker's way in from the box with real Chrome — the TikTok Top
 * Posts reader. Same posture as soundIngest: an authenticated write endpoint on
 * the open internet, so the door comes first; and the ranking must stay the one
 * copy in rankTopPosts, with the six-post cap and views-then-likes order the
 * UI already relies on.
 */
jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  },
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/trackers/creators/ingest/route";
import { TOP_POSTS_LIMIT } from "@/lib/platforms/creatorProfile";

const mockDb = db as unknown as {
  creator: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
};

const TOKEN = "test-creator-ingest-token";
const URL = "http://localhost:3009/api/trackers/creators/ingest";

function get(token: string | null = TOKEN) {
  return new NextRequest(URL, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

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

function makePost(postId: string, views: number | null) {
  return {
    postId,
    url: `https://www.tiktok.com/@h/video/${postId}`,
    caption: null,
    coverUrl: null,
    views,
    likes: 10,
    comments: 1,
    postedAt: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CREATOR_INGEST_TOKEN = TOKEN;
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.creator.findFirst.mockResolvedValue({ id: "c1" });
  mockDb.creator.update.mockResolvedValue({});
});

afterAll(() => {
  delete process.env.CREATOR_INGEST_TOKEN;
});

describe("the door", () => {
  it("refuses a request with no token, before it reads anything", async () => {
    const res = await POST(post({ readings: [{ creatorId: "c1", posts: [makePost("1", 5)] }] }, null));
    expect(res.status).toBe(401);
    expect(mockDb.creator.findFirst).not.toHaveBeenCalled();
  });

  it("refuses the wrong token", async () => {
    const res = await GET(get("not-it"));
    expect(res.status).toBe(401);
    expect(mockDb.creator.findMany).not.toHaveBeenCalled();
  });

  it("refuses everything when no token is configured at all", async () => {
    /* Otherwise an environment that forgot to set one would accept
       "Bearer undefined" from anybody. */
    delete process.env.CREATOR_INGEST_TOKEN;
    const prevSound = process.env.SOUND_INGEST_TOKEN;
    const prevCron = process.env.CRON_SECRET;
    delete process.env.SOUND_INGEST_TOKEN;
    delete process.env.CRON_SECRET;
    try {
      const res = await GET(get("anything"));
      expect(res.status).toBe(401);
    } finally {
      process.env.CREATOR_INGEST_TOKEN = TOKEN;
      if (prevSound !== undefined) process.env.SOUND_INGEST_TOKEN = prevSound;
      if (prevCron !== undefined) process.env.CRON_SECRET = prevCron;
    }
  });

  it("falls back to CRON_SECRET when no dedicated token is set", async () => {
    delete process.env.CREATOR_INGEST_TOKEN;
    const prevSound = process.env.SOUND_INGEST_TOKEN;
    const prevCron = process.env.CRON_SECRET;
    delete process.env.SOUND_INGEST_TOKEN;
    process.env.CRON_SECRET = "cron-secret";
    try {
      const res = await GET(get("cron-secret"));
      expect(res.status).toBe(200);
    } finally {
      process.env.CREATOR_INGEST_TOKEN = TOKEN;
      if (prevSound !== undefined) process.env.SOUND_INGEST_TOKEN = prevSound;
      if (prevCron !== undefined) process.env.CRON_SECRET = prevCron;
      else delete process.env.CRON_SECRET;
    }
  });
});

describe("GET — the work list", () => {
  it("returns only tracked, undeleted TikTok creators with the freshness split", async () => {
    const recent = new Date();
    const ancient = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", handle: "fresh", name: "Fresh", topPostsAt: recent },
      { id: "c2", handle: "old", name: "Old", topPostsAt: ancient },
      { id: "c3", handle: "never", name: "Never", topPostsAt: null },
    ]);

    const res = await GET(get());
    expect(res.status).toBe(200);
    const { creators } = await res.json();

    expect(mockDb.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { platform: "TIKTOK", trackedSince: { not: null }, deletedAt: null },
      })
    );
    expect(creators.map((c: any) => [c.handle, c.readRecently])).toEqual([
      ["fresh", true],
      ["old", false],
      ["never", false],
    ]);
  });
});

describe("POST — recording readings", () => {
  it("ranks by views, keeps the cap, and stamps topPostsAt", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => makePost(String(i), i * 100));
    const res = await POST(post({ readings: [{ creatorId: "c1", posts }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recorded: 1, unknown: 0 });

    const data = mockDb.creator.update.mock.calls[0][0].data;
    expect(data.topPosts).toHaveLength(TOP_POSTS_LIMIT);
    expect(data.topPosts[0].postId).toBe("9"); // highest views first
    expect(data.topPostsAt).toBeInstanceOf(Date);
  });

  it("counts a creator that vanished since the work list as unknown, not an error", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    const res = await POST(post({ readings: [{ creatorId: "gone", posts: [makePost("1", 5)] }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recorded: 0, unknown: 1 });
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it("dryRun reads and reports but writes nothing", async () => {
    const res = await POST(
      post({ readings: [{ creatorId: "c1", posts: [makePost("1", 5)] }], dryRun: true })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recorded: 1, dryRun: true });
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it("rejects an empty posts list — an unread grid must never erase stored posts", async () => {
    const res = await POST(post({ readings: [{ creatorId: "c1", posts: [] }] }));
    expect(res.status).toBe(400);
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ readings: [] }))).status).toBe(400);
  });
});
