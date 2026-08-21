jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}));

import { buildActivityFeed, humanStatus, FEED_ACTIONS } from "@/lib/campaignActivity";
import { db } from "@/lib/db";

const creatorFindMany = db.creator.findMany as jest.Mock;
const userFindMany = db.user.findMany as jest.Mock;

const AT = new Date("2026-08-21T12:00:00.000Z");

function log(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    action: "post.create",
    userId: "u1",
    actorEmail: "maria@demo.com",
    entityId: "p1",
    entityLabel: "@kewbi_",
    metadata: null,
    before: null,
    after: null,
    createdAt: AT,
    ...over,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  creatorFindMany.mockResolvedValue([{ id: "c1", name: "Maria Santos", handle: "mariasantos" }]);
  userFindMany.mockResolvedValue([{ id: "u1", name: "Alex Turner", email: "alex@demo.com" }]);
});

describe("campaign activity feed phrasing", () => {
  it("renders a creator being added with the reference's glyph and wording", async () => {
    const events = await buildActivityFeed(
      [log({ action: "activation.create", after: { campaignId: "cam1", creatorId: "c1" } })],
      []
    );

    expect(events).toHaveLength(1);
    expect(events[0].glyph).toBe("➕");
    expect(events[0].text).toBe(
      "Maria Santos (@mariasantos) has been added to the campaign by Alex Turner"
    );
  });

  it("renders an activation status change, humanising the enum", async () => {
    const events = await buildActivityFeed(
      [
        log({
          action: "activation.update",
          before: { campaignId: "cam1", creatorId: "c1", status: "AWAITING_DRAFT" },
          after: { campaignId: "cam1", creatorId: "c1", status: "AWAITING_APPROVAL" },
        }),
      ],
      []
    );

    expect(events[0].glyph).toBe("🌀");
    expect(events[0].text).toBe(
      "Maria Santos (@mariasantos) status has been changed to Awaiting Approval by Alex Turner"
    );
  });

  it("drops an activation update that changed something other than status", async () => {
    // Notes and URL edits are audit detail; the reference's feed shows only
    // transitions, so a non-status update must not produce a phantom event.
    const events = await buildActivityFeed(
      [
        log({
          action: "activation.update",
          before: { campaignId: "cam1", creatorId: "c1", status: "POSTED", feedbackNotes: null },
          after: { campaignId: "cam1", creatorId: "c1", status: "POSTED", feedbackNotes: "looks good" },
        }),
      ],
      []
    );

    expect(events).toEqual([]);
  });

  it("renders the remaining four event types", async () => {
    const events = await buildActivityFeed(
      [
        log({ id: "e1", action: "post.create", metadata: { campaignId: "cam1" } }),
        log({ id: "e2", action: "post.bulk_create", metadata: { campaignId: "cam1", count: 12 } }),
        log({ id: "e3", action: "post.delete", metadata: { campaignId: "cam1" } }),
        log({
          id: "e4",
          action: "campaign.update",
          entityType: "campaign",
          entityId: "cam1",
          before: { status: "PENDING" },
          after: { status: "IN_PROGRESS" },
        }),
      ],
      []
    );

    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(byId.e1.glyph).toBe("🤳");
    expect(byId.e1.text).toBe("A new post has been added by Alex Turner");
    expect(byId.e2.glyph).toBe("📦");
    expect(byId.e2.text).toBe("12 posts were added by Alex Turner");
    expect(byId.e3.glyph).toBe("🗑️");
    expect(byId.e3.text).toBe("A post has been deleted by Alex Turner");
    expect(byId.e4.glyph).toBe("💡");
    expect(byId.e4.text).toBe("Campaign status has been changed to In Progress by Alex Turner");
  });

  it("falls back to the email local part when the user row is gone", async () => {
    userFindMany.mockResolvedValue([]);
    const events = await buildActivityFeed([log({ metadata: { campaignId: "cam1" } })], []);
    expect(events[0].text).toBe("A new post has been added by maria");
  });

  it("includes comments, tags them so the filter can split them, and sorts newest first", async () => {
    const events = await buildActivityFeed(
      [log({ id: "old", metadata: { campaignId: "cam1" }, createdAt: new Date("2026-08-20T12:00:00.000Z") })],
      [
        {
          id: "c-new",
          content: "Draft looks great",
          createdAt: new Date("2026-08-21T18:00:00.000Z"),
          user: { id: "u1", name: "Alex Turner", email: "alex@demo.com" },
        },
      ]
    );

    expect(events.map((e) => e.id)).toEqual(["c-new", "old"]);
    expect(events[0].kind).toBe("comment");
    expect(events[0].glyph).toBe("💬");
    expect(events[0].text).toBe("Alex Turner: Draft looks great");
    expect(events[1].kind).toBe("event");
  });

  it("ignores an action outside the vocabulary rather than rendering a blank row", async () => {
    const events = await buildActivityFeed([log({ action: "payout.create" })], []);
    expect(events).toEqual([]);
  });

  it("does not query for names when there is nothing to resolve", async () => {
    await buildActivityFeed([], []);
    expect(creatorFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("exports exactly the six actions the route filters on", () => {
    expect([...FEED_ACTIONS]).toEqual([
      "activation.create",
      "activation.update",
      "post.create",
      "post.bulk_create",
      "post.delete",
      "campaign.update",
    ]);
  });

  it("humanises enum statuses", () => {
    expect(humanStatus("DRAFT_DECLINED")).toBe("Draft Declined");
    expect(humanStatus("IN_PROGRESS")).toBe("In Progress");
    expect(humanStatus(null)).toBe("Unknown");
  });
});
