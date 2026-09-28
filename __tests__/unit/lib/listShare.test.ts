/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorListShare: { findUnique: jest.fn() },
    creatorListItem: { findMany: jest.fn() },
    creatorProfileLink: { findMany: jest.fn() },
    creatorDetail: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));

import { db } from "@/lib/db";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import {
  DEFAULT_SHARE_FIELDS,
  loadListShare,
  parseShareFields,
  sharedListCreators,
  type SharedList,
} from "@/lib/lists/listShare";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;

const row = (over: Record<string, unknown> = {}) => ({
  token: "tok",
  orgId: "org-1",
  fields: { stats: true, tags: true, audienceCountry: true, price: false },
  revokedAt: null,
  list: { id: "l1", orgId: "org-1", name: "Anime Pages", description: null, org: { name: "LKAY Media" } },
  ...over,
});

const creator = {
  id: "c1",
  name: "Mira",
  handle: "@@mira",
  platform: "TIKTOK",
  followersCount: 150000,
  averageViews: 9000,
  rate: 40,
  tagLinks: [{ tag: { name: "Motivation" } }, { tag: { name: "Anime" } }],
};

const share = (fields: Partial<SharedList["fields"]> = {}): SharedList => ({
  token: "tok",
  listId: "l1",
  orgId: "org-1",
  name: "Anime Pages",
  description: null,
  orgName: "LKAY Media",
  fields: { ...DEFAULT_SHARE_FIELDS, ...fields },
});

beforeEach(() => {
  jest.clearAllMocks();
  (rosterTablesReady as jest.Mock).mockResolvedValue(true);
  mdb.creatorListItem.findMany.mockResolvedValue([{ creator }]);
  mdb.creatorProfileLink.findMany.mockResolvedValue([
    { creatorId: "c1", platform: "TIKTOK", handle: "mira", url: "https://www.tiktok.com/@mira", followersCount: 150000, averageViews: 9000 },
    { creatorId: "c1", platform: "INSTAGRAM", handle: "mira.ig", url: "https://instagram.com/mira.ig", followersCount: 0, averageViews: null },
  ]);
  mdb.creatorDetail.findMany.mockResolvedValue([{ creatorId: "c1", audienceCountry: "Brazil" }]);
});

describe("parseShareFields", () => {
  it("defaults price off and everything else on, and ignores junk", () => {
    expect(parseShareFields(null)).toEqual({ stats: true, tags: true, audienceCountry: true, price: false });
    expect(parseShareFields({ price: "yes", stats: false, email: true })).toEqual({ stats: false, tags: true, audienceCountry: true, price: false });
  });
});

describe("loadListShare", () => {
  it("returns the list behind a live token", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(row());
    expect(await loadListShare("tok")).toEqual({
      token: "tok",
      listId: "l1",
      orgId: "org-1",
      name: "Anime Pages",
      description: null,
      orgName: "LKAY Media",
      fields: DEFAULT_SHARE_FIELDS,
    });
  });

  it("is null for a revoked token", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(row({ revokedAt: new Date() }));
    expect(await loadListShare("tok")).toBeNull();
  });

  it("is null when the share and its list disagree about the org", async () => {
    mdb.creatorListShare.findUnique.mockResolvedValue(row({ orgId: "org-2" }));
    expect(await loadListShare("tok")).toBeNull();
  });

  it("does not query for an empty or absurd token, or before the tables exist", async () => {
    expect(await loadListShare("")).toBeNull();
    expect(await loadListShare("x".repeat(201))).toBeNull();
    (rosterTablesReady as jest.Mock).mockResolvedValue(false);
    expect(await loadListShare("tok")).toBeNull();
    expect(mdb.creatorListShare.findUnique).not.toHaveBeenCalled();
  });
});

describe("sharedListCreators", () => {
  it("never reads or returns a contact email", async () => {
    const out = await sharedListCreators(share({ price: true }));
    const select = mdb.creatorListItem.findMany.mock.calls[0][0].select.creator.select;
    expect(Object.keys(select)).not.toContain("contactEmail");
    expect(JSON.stringify(out)).not.toMatch(/email/i);
  });

  it("with the defaults shows stats, tags and audience, but not price", async () => {
    const [c] = await sharedListCreators(share());
    expect(c).toEqual({
      id: "c1",
      name: "Mira",
      handle: "mira",
      accounts: [
        { platform: "TIKTOK", handle: "mira", url: "https://www.tiktok.com/@mira", followersCount: 150000, averageViews: 9000 },
        { platform: "INSTAGRAM", handle: "mira.ig", url: "https://instagram.com/mira.ig", followersCount: null, averageViews: null },
      ],
      followersCount: 150000,
      averageViews: 9000,
      tags: ["Anime", "Motivation"],
      audienceCountry: "Brazil",
      rate: null,
    });
  });

  it("leaves out each field that is switched off", async () => {
    const [c] = await sharedListCreators(share({ stats: false, tags: false, audienceCountry: false }));
    expect(c.followersCount).toBeNull();
    expect(c.averageViews).toBeNull();
    expect(c.accounts.every((a) => a.followersCount === null && a.averageViews === null)).toBe(true);
    expect(c.tags).toEqual([]);
    expect(c.audienceCountry).toBeNull();
    expect(mdb.creatorDetail.findMany).not.toHaveBeenCalled();
  });

  it("shows price only when it is switched on", async () => {
    expect((await sharedListCreators(share({ price: true })))[0].rate).toBe(40);
  });

  it("reads only the list's own members, in the org the share belongs to", async () => {
    await sharedListCreators(share());
    expect(mdb.creatorListItem.findMany.mock.calls[0][0].where).toEqual({ listId: "l1", creator: { orgId: "org-1", deletedAt: null } });
    expect(mdb.creatorProfileLink.findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1", creatorId: { in: ["c1"] } });
  });

  it("falls back to the creator's own account when it has no profile links", async () => {
    mdb.creatorProfileLink.findMany.mockResolvedValue([]);
    const [c] = await sharedListCreators(share());
    expect(c.accounts).toEqual([{ platform: "TIKTOK", handle: "mira", url: null, followersCount: 150000, averageViews: null }]);
  });
});
