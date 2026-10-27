/**
 * @jest-environment node
 *
 * The Spotify link through the create and edit routes, once the column
 * exists: what is stored on which song, what is refused before anything is
 * written, and when the first reading is scheduled. Runs the real Prisma
 * client on a fake pool (__tests__/helpers/fakePgPrisma.ts), so the writes
 * asserted here are the SQL statements themselves.
 */
type Row = Record<string, unknown>;
type Fake = import("../../helpers/fakePgPrisma").FakePg;

jest.mock("@/lib/db", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../helpers/fakePgPrisma").createFakePgDb({ songLinkColumns: true })
);

const AUTH = { orgId: "org-1", userId: "user-1", role: "OWNER", campaignScope: "ALL", actorType: "user" };
jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: async () => AUTH,
  getAuditActor: () => ({ actorId: "user-1", actorName: "Owner" }),
}));
jest.mock("@/lib/authz", () => ({ requirePermission: async () => ({ ok: true, auth: AUTH }) }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }));
jest.mock("@/lib/sounds/snapshot", () => ({ primeSongAudio: jest.fn(async () => {}) }));

/* after() is where the first reading goes; captured here so a test can say
   whether it was scheduled, and run it. */
const mockAfter = jest.fn();
jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: (fn: () => unknown) => mockAfter(fn) }));
const mockPrime = jest.fn();
jest.mock("@/lib/songs/streamSnapshot", () => ({
  ...jest.requireActual("@/lib/songs/streamSnapshot"),
  primeSongStreams: (...a: unknown[]) => mockPrime(...a),
}));

import { NextRequest } from "next/server";
import { POST as createCampaign } from "@/app/api/campaigns/route";
import { PATCH as updateCampaign } from "@/app/api/campaigns/[id]/route";
import { primeSongAudio } from "@/lib/sounds/snapshot";

const { fake } = jest.requireMock("@/lib/db") as { fake: Fake };

const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
const OTHER = "0AbCdEfGhIjKlMnOpQrStU";
const spotifyUrl = `https://open.spotify.com/intl-de/track/${TRACK}?si=abc`;
const audioUrl = "https://www.tiktok.com/music/Neon-Skyline-7400000000000000009";

const req = (url: string, body: unknown, method = "POST") =>
  new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "camp-1" }) };

const campaignRow = (over: Row = {}): Row => ({
  id: "camp-1",
  orgId: "org-1",
  title: "Launch",
  status: "IN_PROGRESS",
  campaignType: "BUDGET_BASED",
  currency: "USD",
  songId: "song-1",
  createdById: "user-1",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-20T00:00:00Z"),
  deletedAt: null,
  ...over,
});
const songRow = (over: Row = {}): Row => ({
  id: "song-1",
  orgId: "org-1",
  title: "Neon Skyline",
  artist: "",
  spotifyTrackId: null,
  deletedAt: null,
  ...over,
});

const songLinkWrites = () => fake.sql.filter((q) => q.startsWith('UPDATE "public"."Song"') && q.includes('"spotifyTrackId"'));
const writes = () => fake.sql.filter((q) => /^(INSERT|UPDATE|DELETE)\b/i.test(q));
/** Runs whatever after() was handed, as Next does once the response is sent. */
const runAfter = async () => {
  for (const [fn] of mockAfter.mock.calls) await fn();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAfter.mockReset();
  fake.reset({});
  mockPrime.mockResolvedValue("read");
});

describe("POST /api/campaigns", () => {
  it("refuses an album link by name, before anything is written", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", audioUrl, spotifyUrl: `https://open.spotify.com/album/${TRACK}` }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "album", message: "That's an album link. Open the song and copy its link." });
    expect(fake.sql).not.toContain("BEGIN");
    expect(writes()).toEqual([]);
  });

  it("stores the track on the campaign's song, and takes the first reading after the response", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", audioUrl, spotifyUrl }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.spotifyLinked).toBe(true);
    // The link is written after the campaign's transaction has committed.
    expect(songLinkWrites()).toHaveLength(1);
    expect(fake.sql.indexOf(songLinkWrites()[0])).toBeGreaterThan(fake.sql.indexOf("COMMIT"));
    expect(fake.tables.Song[0].spotifyTrackId).toBe(TRACK);
    // Nothing was read while the request was open.
    expect(mockPrime).not.toHaveBeenCalled();
    await runAfter();
    expect(mockPrime).toHaveBeenCalledWith("org-1", body.songId);
    expect(primeSongAudio).toHaveBeenCalledWith("org-1", body.songId);
  });

  it("makes a song for a campaign that has only a Spotify link", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", spotifyUrl }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.spotifyLinked).toBe(true);
    expect(body.songId).toEqual(expect.any(String));
    expect(fake.tables.Song).toHaveLength(1);
    expect(fake.tables.Song[0]).toMatchObject({ orgId: "org-1", title: "Launch", artist: "", spotifyTrackId: TRACK });
    expect(fake.tables.TikTokSound).toBeUndefined();
  });

  it("stores the link on a closed campaign's song but takes no reading for it", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", spotifyUrl, status: "COMPLETE" }));
    expect(res.status).toBe(201);
    expect(fake.tables.Song[0].spotifyTrackId).toBe(TRACK);
    await runAfter();
    expect(mockPrime).not.toHaveBeenCalled();
  });

  it("answers the same as before for a campaign with no link", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", audioUrl }));
    expect(res.status).toBe(201);
    expect((await res.json()).spotifyLinked).toBeUndefined();
    expect(songLinkWrites()).toEqual([]);
  });
});

describe("PATCH /api/campaigns/[id]", () => {
  beforeEach(() => fake.reset({ Campaign: [campaignRow()], Song: [songRow()] }));

  it("refuses a playlist link by name and leaves the campaign as it was", async () => {
    const res = await updateCampaign(
      req("/api/campaigns/camp-1", { title: "Renamed", spotifyUrl: `https://open.spotify.com/playlist/${TRACK}` }, "PATCH"),
      params
    );
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("That's a playlist link. Open the song and copy its link.");
    expect(writes()).toEqual([]);
  });

  it("saves a new link, and schedules its first reading", async () => {
    const res = await updateCampaign(req("/api/campaigns/camp-1", { spotifyUrl }, "PATCH"), params);
    expect(res.status).toBe(200);
    expect((await res.json()).spotifyTrackId).toBe(TRACK);
    expect(songLinkWrites()).toHaveLength(1);
    // The write moves updatedAt too: the cron stops trusting an older match, and the report's cache key moves.
    expect(songLinkWrites()[0]).toContain('"updatedAt"');
    expect(songLinkWrites()[0]).toMatch(/WHERE .*"orgId"/);
    expect(fake.tables.Song[0].spotifyTrackId).toBe(TRACK);
    await runAfter();
    expect(mockPrime).toHaveBeenCalledWith("org-1", "song-1");
  });

  it("changes nothing, and reads nothing, for the link the song already has", async () => {
    fake.reset({ Campaign: [campaignRow()], Song: [songRow({ spotifyTrackId: TRACK })] });
    const res = await updateCampaign(req("/api/campaigns/camp-1", { spotifyUrl }, "PATCH"), params);
    expect(res.status).toBe(200);
    expect(songLinkWrites()).toEqual([]);
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("replaces another link, with a reading for the new track", async () => {
    fake.reset({ Campaign: [campaignRow()], Song: [songRow({ spotifyTrackId: OTHER })] });
    await updateCampaign(req("/api/campaigns/camp-1", { spotifyUrl }, "PATCH"), params);
    expect(fake.tables.Song[0].spotifyTrackId).toBe(TRACK);
    await runAfter();
    expect(mockPrime).toHaveBeenCalledTimes(1);
  });

  it("clears the link with an empty field, and reads nothing", async () => {
    fake.reset({ Campaign: [campaignRow()], Song: [songRow({ spotifyTrackId: TRACK })] });
    const res = await updateCampaign(req("/api/campaigns/camp-1", { spotifyUrl: "" }, "PATCH"), params);
    expect(res.status).toBe(200);
    expect((await res.json()).spotifyTrackId).toBeNull();
    expect(fake.tables.Song[0].spotifyTrackId).toBeNull();
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("gives a campaign with no song one for the link", async () => {
    fake.reset({ Campaign: [campaignRow({ songId: null })] });
    const res = await updateCampaign(req("/api/campaigns/camp-1", { spotifyUrl }, "PATCH"), params);
    expect(res.status).toBe(200);
    expect(fake.tables.Song).toHaveLength(1);
    expect(fake.tables.Song[0]).toMatchObject({ orgId: "org-1", title: "Launch", spotifyTrackId: TRACK });
    expect(fake.tables.Campaign[0].songId).toBe(fake.tables.Song[0].id);
  });

  it("saves the link on a closed campaign but takes no reading", async () => {
    fake.reset({ Campaign: [campaignRow({ status: "COMPLETE" })], Song: [songRow()] });
    await updateCampaign(req("/api/campaigns/camp-1", { spotifyUrl }, "PATCH"), params);
    expect(fake.tables.Song[0].spotifyTrackId).toBe(TRACK);
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("keeps the save when after() cannot schedule the reading", async () => {
    mockAfter.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    const res = await updateCampaign(req("/api/campaigns/camp-1", { spotifyUrl }, "PATCH"), params);
    expect(res.status).toBe(200);
    expect(fake.tables.Song[0].spotifyTrackId).toBe(TRACK);
  });

  it("swallows a first reading that fails, in the background", async () => {
    mockPrime.mockRejectedValue(new Error("browser launch: timed out"));
    await updateCampaign(req("/api/campaigns/camp-1", { spotifyUrl }, "PATCH"), params);
    await expect(runAfter()).resolves.toBeUndefined();
    expect(mockPrime).toHaveBeenCalledTimes(1);
  });
});
