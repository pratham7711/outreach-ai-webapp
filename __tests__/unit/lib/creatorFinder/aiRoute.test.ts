/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({
  getOrgEntitlements: jest.fn(),
  hasOrgFeature: (e: { featureMap: Record<string, boolean> } | null, key: string) => e?.featureMap[key] === true,
}));
jest.mock("@/lib/db", () => ({
  db: {
    creatorProspect: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
    creatorProspectEvent: { create: jest.fn() },
    campaign: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}));
jest.mock("@/lib/creatorFinder/liveProfile", () => ({
  ...jest.requireActual("@/lib/creatorFinder/liveProfile"),
  readLiveProfile: jest.fn(),
}));
const create = jest.fn();
jest.mock("@/lib/creatorFinder/scoutAi", () => ({
  ...jest.requireActual("@/lib/creatorFinder/scoutAi"),
  scoutAiClient: () => ({ messages: { create } }),
}));

import { authenticateRequest } from "@/lib/authenticate";
import { getOrgEntitlements } from "@/lib/entitlements";
import { db } from "@/lib/db";
import { readLiveProfile } from "@/lib/creatorFinder/liveProfile";
import { POST as AI } from "@/app/api/creator-finder/[id]/ai/route";
import { PATCH } from "@/app/api/creator-finder/[id]/route";
import { GET as BOARD } from "@/app/api/creator-finder/route";
import { GET as CAMPAIGNS } from "@/app/api/creator-finder/campaigns/route";
import { campaignJoinPath } from "@/lib/creatorFinder/campaigns";

const auth = authenticateRequest as jest.Mock;
const ents = getOrgEntitlements as jest.Mock;
const live = readLiveProfile as jest.Mock;
const mdb = db as unknown as {
  creatorProspect: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  campaign: { findMany: jest.Mock; findFirst: jest.Mock; count: jest.Mock };
};

const req = (url: string, body?: unknown, method = "POST") =>
  new NextRequest(`http://localhost${url}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) } as never);
const ctx = { params: Promise.resolve({ id: "p1" }) };
const ytProspect = { id: "p1", orgId: "org-a", platform: "YOUTUBE", handle: "phonkcars", channelId: null, status: "FOUND", aiTags: null };
const ytRead = {
  ok: true,
  platform: "YOUTUBE",
  readAt: "2026-11-01T00:00:00Z",
  contactRoutes: [],
  youtube: {
    channelId: "UC1234567890123456789012",
    handle: "phonkcars",
    title: "Phonk Cars",
    description: "Drift edits. Booking: bookings@phonkcars.com",
    thumbnailUrl: null,
    country: null,
    recent: [{ id: "v1", title: "Supra drift at night", publishedAt: "2026-10-30T12:00:00Z" }],
  },
};

const OLD_ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, SCOUT_ANTHROPIC_API_KEY: "test-key" };
  delete process.env.SCOUT_AI_INSTAGRAM;
  auth.mockResolvedValue({ orgId: "org-a", userId: "u1", role: "OWNER", actorType: "user", actorEmail: null, campaignScope: "ALL" });
  ents.mockResolvedValue({ featureMap: { creator_finder: true, creator_finder_ai: true } });
  mdb.creatorProspect.findFirst.mockResolvedValue(ytProspect);
  live.mockResolvedValue(ytRead);
});
afterAll(() => {
  process.env = OLD_ENV;
});

describe("Scout's AI is off unless the org's switch and the server key are both there", () => {
  it("says the switch is off, without reading the profile or calling the model", async () => {
    ents.mockResolvedValue({ featureMap: { creator_finder: true } });
    const res = await AI(req("/api/creator-finder/p1/ai", { task: "read" }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("ai_off");
    expect(live).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("says the key is missing, and never falls back to the shared ANTHROPIC_API_KEY", async () => {
    delete process.env.SCOUT_ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "shared";
    const res = await AI(req("/api/creator-finder/p1/ai", { task: "read" }), ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("ai_not_configured");
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps Instagram profiles away from the model until SCOUT_AI_INSTAGRAM=on", async () => {
    mdb.creatorProspect.findFirst.mockResolvedValue({ ...ytProspect, platform: "INSTAGRAM", handle: "funk_daily" });
    const res = await AI(req("/api/creator-finder/p1/ai", { task: "read" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ai_instagram_waiting");
    expect(live).not.toHaveBeenCalled();
  });

  it("needs the permission that works the board", async () => {
    auth.mockResolvedValue({ orgId: "org-a", userId: "u2", role: "VIEWER", actorType: "user", actorEmail: null, campaignScope: "ALL" });
    expect((await AI(req("/api/creator-finder/p1/ai", { task: "read" }), ctx)).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("tells the board whether it is on", async () => {
    const body = await (await BOARD(req("/api/creator-finder", undefined, "GET"))).json();
    expect(body.ai).toEqual({ on: true, instagram: false, code: null, reason: null });
  });
});

describe("reading a profile", () => {
  it("stores the labels, sources, model, time and input digest -- not the quotes or contacts", async () => {
    create.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            tags: [{ kind: "content", label: "car edits", source: "post:v1", quote: "Supra drift" }],
            contacts: [{ kind: "email", value: "bookings@phonkcars.com", source: "bio", quote: "Booking: bookings@phonkcars.com" }],
          }),
        },
      ],
    });
    const res = await AI(req("/api/creator-finder/p1/ai", { task: "read" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toEqual([{ kind: "content", label: "car edits", source: "post:v1", quote: "Supra drift", sourceLabel: "Video title" }]);
    expect(body.contacts[0].value).toBe("bookings@phonkcars.com");

    const saved = mdb.creatorProspect.update.mock.calls[0][0];
    expect(saved.where).toEqual({ id: "p1" });
    expect(saved.data.aiTags).toEqual({
      tags: [{ kind: "content", label: "car edits", source: "post:v1" }],
      rejected: [],
      model: "claude-opus-5-5",
      at: expect.any(String),
      inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(saved.data.aiTags)).not.toContain("Supra drift");
    expect(JSON.stringify(saved.data.aiTags)).not.toContain("bookings@");
  });

  it("passes the profile's refusal straight through", async () => {
    live.mockResolvedValue({ ok: false, status: 503, error: "no_youtube_key", reason: "YouTube isn't configured on this server." });
    const res = await AI(req("/api/creator-finder/p1/ai", { task: "read" }), ctx);
    expect(res.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("drafting a first message", () => {
  it("puts the chosen campaign's join link under the draft", async () => {
    mdb.campaign.findFirst.mockResolvedValue({
      id: "c1",
      title: "Drift Phonk Push",
      publicSlug: "drift-phonk",
      marketplaceVisibility: "INVITE_ONLY",
      inviteCode: "AB12CD",
      guidelines: null,
      requirements: null,
    });
    create.mockResolvedValue({ content: [{ type: "text", text: "Collab\nLoved the Supra drift video." }] });
    const res = await AI(req("/api/creator-finder/p1/ai", { task: "draft", example: "Hi!", campaignId: "c1" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.body).toBe("Loved the Supra drift video.\n\nhttp://localhost/portal/register?join=drift-phonk&invite=AB12CD");
    expect(mdb.creatorProspect.update).not.toHaveBeenCalled();
    expect(mdb.campaign.findFirst.mock.calls[0][0].where).toMatchObject({ id: "c1", orgId: "org-a", status: "IN_PROGRESS" });
  });

  it("refuses a campaign that has no join link", async () => {
    mdb.campaign.findFirst.mockResolvedValue(null);
    const res = await AI(req("/api/creator-finder/p1/ai", { task: "draft", example: "Hi!", campaignId: "private" }), ctx);
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("marking a tag wrong", () => {
  it("takes it off the card and keeps it, with who and when, so it can't come back", async () => {
    mdb.creatorProspect.findFirst.mockResolvedValue({
      ...ytProspect,
      aiTags: { tags: [{ kind: "content", label: "car edits", source: "bio" }, { kind: "language", label: "portuguese", source: "bio" }], rejected: [], model: "m", at: "t", inputDigest: "d" },
    });
    mdb.creatorProspect.update.mockResolvedValue({});
    const res = await PATCH(req("/api/creator-finder/p1", { rejectTag: { kind: "language", label: "portuguese" } }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    const data = mdb.creatorProspect.update.mock.calls[0][0].data.aiTags;
    expect(data.tags).toEqual([{ kind: "content", label: "car edits", source: "bio" }]);
    expect(data.rejected).toEqual([{ kind: "language", label: "portuguese", by: "u1", at: expect.any(String) }]);
  });

  it("rejects a malformed tag", async () => {
    const res = await PATCH(req("/api/creator-finder/p1", { rejectTag: { kind: "followers", label: "x" } }, "PATCH"), ctx);
    expect(res.status).toBe(400);
  });
});

describe("campaigns a message can invite into", () => {
  it("builds the marketplace join link, with the code only for invite-only campaigns", () => {
    expect(campaignJoinPath("drift-phonk", "AB12CD")).toBe("/portal/register?join=drift-phonk&invite=AB12CD");
    expect(campaignJoinPath("open-one", null)).toBe("/portal/register?join=open-one");
  });

  it("lists open campaigns with a join link, and counts the open ones without", async () => {
    mdb.campaign.findMany.mockResolvedValue([
      { id: "c1", title: "Drift", publicSlug: "drift", marketplaceVisibility: "INVITE_ONLY", inviteCode: "AB12CD" },
      { id: "c2", title: "Open", publicSlug: "open", marketplaceVisibility: "GLOBAL", inviteCode: "IGNORED" },
    ]);
    mdb.campaign.count.mockResolvedValue(5);
    const body = await (await CAMPAIGNS(req("/api/creator-finder/campaigns", undefined, "GET"))).json();
    expect(body).toEqual({
      campaigns: [
        { id: "c1", title: "Drift", joinPath: "/portal/register?join=drift&invite=AB12CD" },
        { id: "c2", title: "Open", joinPath: "/portal/register?join=open" },
      ],
      otherOpen: 3,
    });
    const where = mdb.campaign.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ orgId: "org-a", deletedAt: null, status: "IN_PROGRESS", publicSlug: { not: null } });
    expect(where.AND).toHaveLength(3);
  });

  it("applies a scoped user's campaign scope", async () => {
    auth.mockResolvedValue({ orgId: "org-a", userId: "u3", role: "MANAGER", actorType: "user", actorEmail: null, campaignScope: "ASSIGNED" });
    await CAMPAIGNS(req("/api/creator-finder/campaigns", undefined, "GET"));
    const scope = mdb.campaign.findMany.mock.calls[0][0].where.AND[2];
    expect(Object.keys(scope).length).toBeGreaterThan(0);
  });
});
