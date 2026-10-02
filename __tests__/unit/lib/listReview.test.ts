/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorListShare: { findUnique: jest.fn(), findMany: jest.fn() },
    creatorListDetail: { findFirst: jest.fn() },
    creatorListItem: { findMany: jest.fn() },
    creatorListItemDetail: { findMany: jest.fn() },
    post: { groupBy: jest.fn() },
  },
}));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/lists/approvalTables", () => ({ listApprovalTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { applyShareReview, pitchOrder, type ItemDetail } from "@/lib/lists/listReview";
import type { SharedCreator, SharedList } from "@/lib/lists/listShare";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;

const share = (price = true): SharedList => ({
  token: "fake-share-token",
  listId: "list-1",
  orgId: "org-1",
  name: "Spring pitch",
  description: null,
  orgName: "Agency",
  fields: { stats: true, tags: true, audienceCountry: true, price },
});
const creator = (id: string, rate: number | null = null): SharedCreator => ({
  id,
  name: `Fake ${id}`,
  handle: `fake_${id}`,
  accounts: [
    { platform: "TIKTOK", handle: `fake_${id}`, url: null, followersCount: 100, averageViews: null },
    { platform: "INSTAGRAM", handle: `fake_${id}`, url: null, followersCount: 50, averageViews: null },
  ],
  followersCount: 150,
  averageViews: null,
  tags: [],
  audienceCountry: null,
  rate,
});
const detail = (itemId: string, over: Partial<ItemDetail> & Record<string, unknown>) => ({
  itemId,
  rate: null,
  notes: null,
  sortOrder: null,
  decision: "PENDING",
  decisionNote: null,
  decidedAt: null,
  ...over,
});
const withReview = (review: Record<string, unknown>) =>
  mdb.creatorListShare.findUnique.mockResolvedValue({ fields: { stats: true, tags: true, audienceCountry: true, price: true, review } });

beforeEach(() => {
  jest.clearAllMocks();
  (listApprovalTablesReady as jest.Mock).mockResolvedValue(true);
  withReview({});
  mdb.creatorListShare.findMany.mockResolvedValue([{ listId: "list-1" }]);
  mdb.creatorListDetail.findFirst.mockResolvedValue(null);
  mdb.creatorListItem.findMany.mockResolvedValue([
    { id: "item-a", creatorId: "a" },
    { id: "item-b", creatorId: "b" },
  ]);
  mdb.creatorListItemDetail.findMany.mockResolvedValue([
    detail("item-b", { sortOrder: 0, rate: 1200, notes: "agency only", decision: "REJECTED", decisionNote: "Too pricey" }),
    detail("item-a", { sortOrder: 1, decision: "APPROVED" }),
  ]);
  mdb.post.groupBy.mockResolvedValue([{ creatorId: "a", _sum: { viewsCount: 1000, likesCount: 40, commentsCount: 5, sharesCount: 5 } }]);
});

describe("applyShareReview", () => {
  it("hands back the creators untouched while the approval tables are absent", async () => {
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(false);
    const creators = [creator("a", 500), creator("b")];
    expect(await applyShareReview(share(), creators)).toEqual({ creators, review: null });
    expect(mdb.creatorListItemDetail.findMany).not.toHaveBeenCalled();
  });

  it("puts the creators in pitch order with each one's verdict", async () => {
    const { creators, review } = await applyShareReview(share(), [creator("a"), creator("b")]);
    expect(creators.map((c) => c.id)).toEqual(["b", "a"]);
    expect(review?.verdicts).toEqual({
      b: { decision: "REJECTED", note: "Too pricey", engagementRate: null },
      a: { decision: "APPROVED", note: null, engagementRate: 5 },
    });
    expect(review?.counts).toEqual({ total: 2, approved: 1, rejected: 1, pending: 0 });
    expect(review?.closed).toBe(false);
  });

  it("prices from the list's rate, falling back to the roster's, and only while price is shown", async () => {
    const shown = await applyShareReview(share(true), [creator("a", 500), creator("b", 800)]);
    expect(shown.creators.map((c) => [c.id, c.rate])).toEqual([["b", 1200], ["a", 500]]);
    const hidden = await applyShareReview(share(false), [creator("a", null), creator("b", null)]);
    expect(hidden.creators.every((c) => c.rate === null)).toBe(true);
  });

  it("totals the rates only when both price and the total are switched on", async () => {
    expect((await applyShareReview(share(true), [creator("a", 500), creator("b")])).review?.rateTotal).toBeNull();
    withReview({ rateTotal: true });
    expect((await applyShareReview(share(true), [creator("a", 500), creator("b")])).review?.rateTotal).toBe(1700);
    expect((await applyShareReview(share(false), [creator("a", 500), creator("b")])).review?.rateTotal).toBeNull();
  });

  it("never publishes the agency's own notes, and hides the client's note with feedback off", async () => {
    withReview({ feedback: false });
    const { creators, review } = await applyShareReview(share(), [creator("a"), creator("b")]);
    expect(JSON.stringify({ creators, review })).not.toContain("agency only");
    expect(review?.verdicts.b.note).toBeNull();
  });

  it("drops accounts on platforms the link leaves out", async () => {
    withReview({ platforms: ["INSTAGRAM"] });
    const { creators } = await applyShareReview(share(), [creator("a")]);
    expect(creators[0].accounts.map((a) => a.platform)).toEqual(["INSTAGRAM"]);
  });

  it("skips the engagement query when the switch is off", async () => {
    withReview({ engagementRate: false });
    const { review } = await applyShareReview(share(), [creator("a")]);
    expect(mdb.post.groupBy).not.toHaveBeenCalled();
    expect(review?.verdicts.a.engagementRate).toBeNull();
  });

  it("reports an archived list as closed", async () => {
    mdb.creatorListDetail.findFirst.mockResolvedValue({ isFavorite: false, archivedAt: new Date(), duplicatedFromId: null });
    expect((await applyShareReview(share(), [creator("a")])).review?.closed).toBe(true);
  });

  it("reads everything through the share's own org and list", async () => {
    await applyShareReview(share(), [creator("a")]);
    expect(mdb.creatorListItem.findMany.mock.calls[0][0].where).toEqual({ listId: "list-1", creator: { orgId: "org-1", deletedAt: null } });
    expect(mdb.creatorListItemDetail.findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1", listId: "list-1" });
  });
});

describe("pitchOrder", () => {
  it("puts ordered rows first and keeps arrival order for the rest", () => {
    const details = new Map<string, ItemDetail>([
      ["x", { rate: null, notes: null, sortOrder: 1, decision: "PENDING", decisionNote: null, decidedAt: null }],
      ["y", { rate: null, notes: null, sortOrder: 0, decision: "PENDING", decisionNote: null, decidedAt: null }],
    ]);
    expect(pitchOrder([{ id: "new2" }, { id: "x" }, { id: "new1" }, { id: "y" }], details).map((i) => i.id)).toEqual(["y", "x", "new2", "new1"]);
  });
});
