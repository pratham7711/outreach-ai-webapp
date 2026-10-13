/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn() },
    creatorSocialAccount: { findMany: jest.fn() },
    activation: { findMany: jest.fn() },
    campaignInvite: { findMany: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import {
  buildHomeTodo,
  listInvitedCampaigns,
  listJoinedCampaigns,
  type JoinedCampaign,
} from "@/lib/portal/myCampaigns";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const session = { creatorUserId: "cu-1", handle: "fake_creator_one" };
const NOW = new Date("2026-10-02T09:00:00Z");

/** creator.findMany answers the identity query (where.creatorUserId) and the
    handle query (where.OR on handle) differently. */
function roster({ identity = [] as string[], byHandle = [] as string[] }) {
  mdb.creator.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    if ("creatorUserId" in args.where) {
      return identity.map((id) => ({ id, orgId: "org-1", platform: "TIKTOK", handle: "fake_creator_one" }));
    }
    return byHandle.map((id) => ({ id, orgId: "org-2" }));
  });
}

const activation = (over: Record<string, unknown> = {}) => ({
  id: "act-1",
  creatorId: "cr-mine",
  status: "ACCEPTED",
  deliverableDueDate: new Date("2026-10-10T00:00:00Z"),
  feedbackNotes: null,
  campaign: {
    id: "camp-1",
    title: "Autumn Drop",
    status: "IN_PROGRESS",
    publicSlug: null,
    submissionDeadline: new Date("2026-10-10T00:00:00Z"),
    org: { name: "Agency One", brandName: null },
    phases: [],
  },
  _count: { posts: 0 },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mdb.activation.findMany.mockResolvedValue([]);
  mdb.campaignInvite.findMany.mockResolvedValue([]);
  mdb.creatorSocialAccount.findMany.mockResolvedValue([]);
});

describe("listJoinedCampaigns", () => {
  it("asks for nothing when no roster row stands behind the login", async () => {
    roster({});
    expect(await listJoinedCampaigns(session, NOW)).toEqual([]);
    expect(mdb.activation.findMany).not.toHaveBeenCalled();
  });

  /* F10: a handle anyone can register must not open an agency's private
     campaigns. Identity rows reach everything; handle rows reach the marketplace. */
  it("restricts handle-only rows to marketplace campaigns and leaves identity rows unrestricted", async () => {
    roster({ identity: ["cr-mine"], byHandle: ["cr-mine", "cr-same-name"] });
    await listJoinedCampaigns(session, NOW);

    const where = mdb.activation.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.campaign).toEqual({ deletedAt: null });
    expect(where.OR).toEqual([
      { creatorId: { in: ["cr-mine"] } },
      {
        creatorId: { in: ["cr-same-name"] },
        campaign: { marketplaceVisibility: { not: "PRIVATE" }, publicSlug: { not: null } },
      },
    ]);
  });

  it("uses only the marketplace branch when no row is linked by identity", async () => {
    roster({ byHandle: ["cr-same-name"] });
    await listJoinedCampaigns(session, NOW);
    const where = mdb.activation.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(1);
    expect(where.OR[0].campaign.marketplaceVisibility).toEqual({ not: "PRIVATE" });
  });

  it("shapes a joined campaign with its link, next date and draft feedback", async () => {
    roster({ identity: ["cr-mine"] });
    mdb.activation.findMany.mockResolvedValue([
      activation({ status: "DECLINED", feedbackNotes: "Shorter intro please" }),
    ]);
    const [c] = await listJoinedCampaigns(session, NOW);
    expect(c).toMatchObject({
      campaignId: "camp-1",
      href: "/portal/campaigns/camp-1",
      title: "Autumn Drop",
      orgName: "Agency One",
      actionable: true,
      postsSubmitted: 0,
      feedback: "Shorter intro please",
      next: { kind: "post_due", at: "2026-10-10T00:00:00.000Z" },
    });
  });

  /* The campaign is public; the agency's note on a declined draft is not. A
     login that only shares the roster handle sees the campaign without it. */
  it("withholds draft feedback on a handle-only row until the login proves it owns the row", async () => {
    roster({ byHandle: ["cr-same-name"] });
    mdb.activation.findMany.mockResolvedValue([
      activation({ creatorId: "cr-same-name", status: "DECLINED", feedbackNotes: "Shorter intro please" }),
    ]);
    const [unproven] = await listJoinedCampaigns(session, NOW);
    expect(unproven.campaignId).toBe("camp-1");
    expect(unproven.feedback).toBeNull();

    mdb.creatorSocialAccount.findMany.mockResolvedValue([
      { creatorId: "cr-same-name", handle: "@Fake_Creator_One" },
    ]);
    const [proven] = await listJoinedCampaigns(session, NOW);
    expect(proven.feedback).toBe("Shorter intro please");
  });

  it("lists a campaign once when two roster rows are both on it", async () => {
    roster({ identity: ["cr-a", "cr-b"] });
    mdb.activation.findMany.mockResolvedValue([activation(), activation({ id: "act-2" })]);
    expect(await listJoinedCampaigns(session, NOW)).toHaveLength(1);
  });

  it("names the agency by its brand when it has one", async () => {
    roster({ identity: ["cr-mine"] });
    const a = activation();
    a.campaign.org = { name: "Agency One", brandName: "Brand Co" } as never;
    mdb.activation.findMany.mockResolvedValue([a]);
    expect((await listJoinedCampaigns(session, NOW))[0].orgName).toBe("Brand Co");
  });
});

describe("listInvitedCampaigns", () => {
  const invite = (campaignId: string, token = "cinvtoken000000000000001") => ({
    inviteToken: token,
    createdAt: new Date("2026-09-30T00:00:00Z"),
    campaign: {
      id: campaignId,
      title: "Winter Teaser",
      submissionDeadline: null,
      org: { name: "Agency One", brandName: null },
    },
  });

  it("reads only invites addressed to identity-linked roster rows", async () => {
    roster({ identity: [], byHandle: ["cr-same-name"] });
    expect(await listInvitedCampaigns(session)).toEqual([]);
    expect(mdb.campaignInvite.findMany).not.toHaveBeenCalled();
  });

  it("lists pending invites with the landing page as the link", async () => {
    roster({ identity: ["cr-mine"] });
    mdb.campaignInvite.findMany.mockResolvedValue([invite("camp-9")]);
    const out = await listInvitedCampaigns(session);
    expect(mdb.campaignInvite.findMany.mock.calls[0][0].where).toEqual({
      creatorId: { in: ["cr-mine"] },
      status: "PENDING",
      campaign: { deletedAt: null },
    });
    expect(out).toEqual([
      {
        campaignId: "camp-9",
        href: "/invite/cinvtoken000000000000001",
        title: "Winter Teaser",
        orgName: "Agency One",
        submissionDeadline: null,
        invitedAt: "2026-09-30T00:00:00.000Z",
      },
    ]);
  });

  it("drops an invite to a campaign the creator is already on", async () => {
    roster({ identity: ["cr-mine"] });
    mdb.campaignInvite.findMany.mockResolvedValue([invite("camp-1"), invite("camp-9")]);
    const out = await listInvitedCampaigns(session, new Set(["camp-1"]));
    expect(out.map((i) => i.campaignId)).toEqual(["camp-9"]);
  });
});

describe("buildHomeTodo", () => {
  const joined = (over: Partial<JoinedCampaign> = {}): JoinedCampaign => ({
    campaignId: "camp-1",
    href: "/portal/campaigns/camp-1",
    title: "Autumn Drop",
    orgName: "Agency One",
    campaignStatus: "IN_PROGRESS",
    activationStatus: "ACCEPTED",
    actionable: true,
    postsSubmitted: 0,
    feedback: null,
    deliverableDueDate: null,
    submissionDeadline: null,
    next: null,
    ...over,
  });

  it("puts connecting an account first when none is connected", () => {
    const todo = buildHomeTodo([joined()], 0);
    expect(todo.map((t) => t.kind)).toEqual(["connect", "post_due"]);
    expect(todo[0]).toMatchObject({ href: "/portal/accounts" });
  });

  it("drops the connect step once an account is connected", () => {
    expect(buildHomeTodo([], 1)).toEqual([]);
  });

  it("orders posts due soonest first, undated last, then drafts with feedback", () => {
    const todo = buildHomeTodo(
      [
        joined({ campaignId: "undated", title: "Undated" }),
        joined({ campaignId: "late", title: "Late", deliverableDueDate: "2026-11-01T00:00:00.000Z" }),
        joined({ campaignId: "soon", title: "Soon", submissionDeadline: "2026-10-05T00:00:00.000Z" }),
        joined({
          campaignId: "fb",
          title: "Feedback",
          activationStatus: "DECLINED",
          feedback: "Brighter lighting",
        }),
      ],
      2,
    );
    expect(todo.map((t) => ("campaignTitle" in t ? `${t.kind}:${t.campaignTitle}` : t.kind))).toEqual([
      "post_due:Soon",
      "post_due:Late",
      "post_due:Undated",
      "draft_feedback:Feedback",
    ]);
  });

  it("asks for nothing on a campaign that has closed or already has a post", () => {
    const todo = buildHomeTodo(
      [
        joined({ actionable: false }),
        joined({ postsSubmitted: 1 }),
        joined({ actionable: false, activationStatus: "DECLINED", feedback: "Too late" }),
      ],
      1,
    );
    expect(todo).toEqual([]);
  });
});
