/**
 * @jest-environment node
 *
 * The reads that decide which options three dialogs draw: the campaign Share
 * dialog's facts, the list Share panel's platforms, and the tags a roster
 * selection carries. Each is scoped to the caller's org, and a failed read
 * still answers the link -- the dialog then shows every option, as before.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    report: { findMany: jest.fn() },
    post: { findMany: jest.fn(), count: jest.fn() },
    campaignRules: { findFirst: jest.fn() },
    creatorList: { findFirst: jest.fn() },
    creatorListShare: { findUnique: jest.fn() },
    creatorListItem: { findMany: jest.fn() },
    creatorProfileLink: { findMany: jest.fn() },
    creator: { findMany: jest.fn(), count: jest.fn() },
    creatorTagDef: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/lists/approvalTables", () => ({ listApprovalTablesReady: jest.fn().mockResolvedValue(true) }));

import { GET as campaignShare } from "@/app/api/campaigns/[id]/share/route";
import { GET as listShare } from "@/app/api/lists/[id]/share/route";
import { GET as heldTags } from "@/app/api/creators/tags/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { DEFAULT_SHARE_REVIEW } from "@/lib/lists/shareSettings";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const get = (url: string) => new NextRequest(`http://localhost${url}`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1", role: "OWNER", campaignScope: "ALL" } });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => (console.error as jest.Mock).mockRestore());

describe("GET /api/campaigns/[id]/share facts", () => {
  beforeEach(() => {
    mdb.campaign.findFirst.mockResolvedValue({ id: "camp-1", title: "Spring", budget: 5000 });
    mdb.report.findMany.mockResolvedValue([]);
    mdb.post.findMany.mockResolvedValue([{ platform: "YOUTUBE" }, { platform: "TIKTOK" }, { platform: "SNAPCHAT" }]);
    mdb.post.count.mockResolvedValue(2);
    mdb.campaignRules.findFirst.mockResolvedValue(null);
  });

  it("reports the share platforms the campaign has posts on, in chip order, and the rest of the facts", async () => {
    const res = await campaignShare(get("/api/campaigns/camp-1/share"), params("camp-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      link: null,
      facts: { platforms: ["TIKTOK", "YOUTUBE"], hasBudget: true, hasBrief: false, removedPosts: 2 },
    });
  });

  it("reads only this org's posts and rules, leaving posts removed from the campaign out", async () => {
    await campaignShare(get("/api/campaigns/camp-1/share"), params("camp-1"));
    const scope = { campaignId: "camp-1", campaign: { orgId: "org-1" }, removedAt: null };
    expect(mdb.post.findMany.mock.calls[0][0].where).toEqual(scope);
    expect(mdb.post.count.mock.calls[0][0].where).toMatchObject(scope);
    expect(mdb.campaignRules.findFirst.mock.calls[0][0].where).toEqual({ campaignId: "camp-1", orgId: "org-1" });
  });

  it("calls a zero or missing budget no budget", async () => {
    mdb.campaign.findFirst.mockResolvedValue({ id: "camp-1", title: "Spring", budget: 0 });
    expect((await (await campaignShare(get("/api/campaigns/camp-1/share"), params("camp-1"))).json()).facts.hasBudget).toBe(false);
    mdb.campaign.findFirst.mockResolvedValue({ id: "camp-1", title: "Spring", budget: null });
    expect((await (await campaignShare(get("/api/campaigns/camp-1/share"), params("camp-1"))).json()).facts.hasBudget).toBe(false);
  });

  it("still answers the link when the facts cannot be read", async () => {
    mdb.report.findMany.mockResolvedValue([
      { id: "rep-1", shareToken: "tok", isPublic: true, createdAt: new Date("2026-01-01T00:00:00Z"), config: { kind: "campaign-performance" } },
    ]);
    mdb.post.findMany.mockRejectedValue(new Error("db down"));
    const body = await (await campaignShare(get("/api/campaigns/camp-1/share"), params("camp-1"))).json();
    expect(body.link).toMatchObject({ token: "tok" });
    expect(body.facts).toBeNull();
  });
});

describe("GET /api/lists/[id]/share platforms", () => {
  const live = {
    listId: "list-1",
    token: "tok",
    fields: { stats: true, tags: true, audienceCountry: true, price: false, review: { ...DEFAULT_SHARE_REVIEW } },
    revokedAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
  };

  beforeEach(() => {
    mdb.creatorList.findFirst.mockResolvedValue({ id: "list-1", name: "Spring pitch" });
    mdb.creatorListShare.findUnique.mockResolvedValue(live);
    mdb.creatorListItem.findMany.mockResolvedValue([
      { creator: { id: "a", platform: "TIKTOK" } },
      { creator: { id: "b", platform: "TIKTOK" } },
    ]);
    mdb.creatorProfileLink.findMany.mockResolvedValue([
      { creatorId: "b", platform: "INSTAGRAM" },
      { creatorId: "b", platform: "YOUTUBE" },
    ]);
  });

  it("lists a creator's linked accounts, or its own platform when it has none", async () => {
    const body = await (await listShare(get("/api/lists/list-1/share"), params("list-1"))).json();
    expect(body.platforms.sort()).toEqual(["INSTAGRAM", "TIKTOK", "YOUTUBE"]);
  });

  it("reads only this org's creators and links", async () => {
    await listShare(get("/api/lists/list-1/share"), params("list-1"));
    expect(mdb.creatorListItem.findMany.mock.calls[0][0].where).toEqual({ listId: "list-1", creator: { orgId: "org-1", deletedAt: null } });
    expect(mdb.creatorProfileLink.findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1", creatorId: { in: ["a", "b"] } });
  });

  it("does not read platforms for a list with no live link", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(null);
    expect(await (await listShare(get("/api/lists/list-1/share"), params("list-1"))).json()).toEqual({ share: null });
    expect(mdb.creatorListItem.findMany).not.toHaveBeenCalled();
  });

  it("answers null platforms when the read fails, and still serves the link", async () => {
    mdb.creatorListItem.findMany.mockRejectedValue(new Error("db down"));
    const body = await (await listShare(get("/api/lists/list-1/share"), params("list-1"))).json();
    expect(body.share).toMatchObject({ token: "tok" });
    expect(body.platforms).toBeNull();
  });
});

describe("GET /api/creators/tags", () => {
  beforeEach(() => {
    mdb.creator.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    mdb.creatorTagDef.findMany.mockResolvedValue([{ name: "Anime" }, { name: "Priority" }]);
  });

  it("names the tags the picked creators carry, read in the caller's org", async () => {
    const res = await heldTags(get("/api/creators/tags?ids=a,b"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: ["Anime", "Priority"] });
    expect(mdb.creator.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["a", "b"] }, orgId: "org-1", deletedAt: null });
    expect(mdb.creatorTagDef.findMany.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      creators: { some: { creatorId: { in: ["a", "b"] } } },
    });
  });

  it("refuses a creator outside the org rather than reading its tags", async () => {
    mdb.creator.findMany.mockResolvedValue([{ id: "a" }]);
    expect((await heldTags(get("/api/creators/tags?ids=a,zz"))).status).toBe(404);
    expect(mdb.creatorTagDef.findMany).not.toHaveBeenCalled();
  });

  it("takes the roster's filters when no ids are given", async () => {
    mdb.creator.count.mockResolvedValue(2);
    const res = await heldTags(get("/api/creators/tags?tags=Anime"));
    expect(res.status).toBe(200);
    expect(mdb.creator.count.mock.calls[0][0].where).toMatchObject({ orgId: "org-1" });
  });
});
