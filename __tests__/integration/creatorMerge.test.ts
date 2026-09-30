/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => {
  const fns = (...names: string[]) => Object.fromEntries(names.map((n) => [n, jest.fn()]));
  const db: Record<string, unknown> = {
    creator: fns("findFirst", "update"),
    creatorProfileLink: fns("findMany", "updateMany", "createMany"),
    creatorDetail: fns("findFirst", "update"),
    activation: fns("updateMany"),
    post: fns("count", "updateMany"),
    payout: fns("count", "updateMany"),
    payoutRequest: fns("count", "updateMany"),
    negotiationOffer: fns("count", "updateMany"),
    campaignInvite: fns("count", "updateMany"),
    creatorReview: fns("count", "updateMany"),
    viewLedger: fns("count", "updateMany"),
    viewFraudFlag: fns("count", "updateMany"),
    deliverable: fns("count", "updateMany"),
    creatorTagLink: fns("createMany", "deleteMany"),
    creatorFlagLink: fns("createMany", "deleteMany"),
    creatorListItem: fns("createMany", "deleteMany"),
    creatorSocialAccount: fns("updateMany"),
    mediaKit: fns("findMany", "update"),
  };
  db.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db };
});
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn(async () => true) }));

import { POST } from "@/app/api/creators/[id]/merge/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const mockAuth = auth as jest.Mock;
const m = db as any;

const base = {
  platform: "YOUTUBE",
  contactEmail: null,
  rate: null,
  boostRate: null,
  bio: null,
  paymentInfo: null,
  notes: null,
  niches: [],
  trackedSince: null,
  creatorUserId: null,
  activations: [],
  tagLinks: [],
  flagLinks: [],
  listItems: [],
  socialAccounts: [],
};
const KEEP = { ...base, id: "keep-1", name: "Synth Channel", handle: "@synthchannel" };
const DROP = {
  ...base,
  id: "drop-1",
  name: "Synth Channel Display",
  handle: "Synth Channel Display",
  contactEmail: "synth@example.com",
  activations: [{ id: "act-d", campaignId: "camp-1" }],
  tagLinks: [{ tagId: "tag-1" }],
  listItems: [{ listId: "list-1", addedAt: new Date("2026-05-01") }],
};

function post(body: unknown, id = "keep-1") {
  return POST(new NextRequest(`http://localhost/api/creators/${id}/merge`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u-1", orgId: "org-1", role: "ADMIN", email: "a@example.com" } });
  m.creator.findFirst.mockImplementation(async ({ where }: any) => (where.id === "keep-1" ? KEEP : where.id === "drop-1" ? DROP : null));
  m.creatorProfileLink.findMany.mockResolvedValue([]);
  m.creatorDetail.findFirst.mockResolvedValue(null);
  for (const k of ["post", "payout", "payoutRequest", "negotiationOffer", "campaignInvite", "creatorReview", "viewLedger", "viewFraudFlag"]) m[k].count.mockResolvedValue(0);
  m.post.count.mockResolvedValue(7);
  m.mediaKit.findMany.mockResolvedValue([{ id: "kit-1", creatorIds: ["drop-1", "other"] }, { id: "kit-2", creatorIds: ["other"] }]);
});

describe("POST /api/creators/[id]/merge", () => {
  it("needs the delete permission", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await post({ from: "drop-1" })).status).toBe(401);
    mockAuth.mockResolvedValueOnce({ user: { id: "u-2", orgId: "org-1", role: "MEMBER" } });
    expect((await post({ from: "drop-1" })).status).toBe(403);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("reads both creators inside the caller's org only", async () => {
    await post({ from: "drop-1", dryRun: true, orgId: "org-evil" });
    for (const call of m.creator.findFirst.mock.calls) expect(call[0].where).toMatchObject({ orgId: "org-1", deletedAt: null });
  });

  it("answers 404 when either creator is not in the org", async () => {
    expect((await post({ from: "someone-elses" })).status).toBe(404);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("answers 409 for a creator merged into itself", async () => {
    expect((await post({ from: "keep-1" })).status).toBe(409);
  });

  it("previews without writing on a dry run", async () => {
    const res = await post({ from: "drop-1", dryRun: true });
    expect(res.status).toBe(200);
    expect((await res.json()).summary).toMatchObject({ posts: 7, activations: 1, tags: 1, lists: 1, filled: ["contactEmail"] });
    expect(m.$transaction).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("moves the duplicate's rows onto the kept creator and retires it", async () => {
    const res = await post({ from: "drop-1" });
    expect(res.status).toBe(200);
    expect(m.creator.update).toHaveBeenCalledWith({ where: { id: "drop-1", orgId: "org-1" }, data: { deletedAt: expect.any(Date), creatorUserId: null } });
    expect(m.creator.update).toHaveBeenCalledWith({ where: { id: "keep-1", orgId: "org-1" }, data: { contactEmail: "synth@example.com" } });
    expect(m.post.updateMany).toHaveBeenCalledWith({ where: { creatorId: "drop-1" }, data: { creatorId: "keep-1" } });
    // A table with nothing on the duplicate is not touched, so one missing from production cannot fail the merge.
    expect(m.payout.updateMany).not.toHaveBeenCalled();
    expect(m.activation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["act-d"] }, creatorId: "drop-1" }, data: { creatorId: "keep-1" } });
    expect(m.creatorTagLink.createMany).toHaveBeenCalledWith({ data: [{ creatorId: "keep-1", tagId: "tag-1" }], skipDuplicates: true });
    expect(m.creatorListItem.deleteMany).toHaveBeenCalledWith({ where: { creatorId: "drop-1" } });
    expect(m.mediaKit.update).toHaveBeenCalledWith({ where: { id: "kit-1" }, data: { creatorIds: ["keep-1", "other"] } });
    expect(m.mediaKit.update).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "creator.merge", entityId: "keep-1" }));
  });

  it("folds an activation on a campaign both creators are on", async () => {
    m.creator.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === "keep-1" ? { ...KEEP, activations: [{ id: "act-k", campaignId: "camp-1" }] } : where.id === "drop-1" ? DROP : null,
    );
    m.deliverable.count.mockResolvedValue(2);
    m.viewLedger.count.mockResolvedValue(0);
    await post({ from: "drop-1" });
    expect(m.post.updateMany).toHaveBeenCalledWith({ where: { activationId: "act-d" }, data: { activationId: "act-k" } });
    expect(m.deliverable.updateMany).toHaveBeenCalledWith({ where: { activationId: "act-d" }, data: { activationId: "act-k" } });
    expect(m.viewLedger.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { activationId: "act-d" } }));
    expect(m.activation.updateMany).toHaveBeenCalledWith({ where: { id: "act-d", creatorId: "drop-1" }, data: { deletedAt: expect.any(Date) } });
  });

  it("adds an older Instagram record's account to the kept creator as a link", async () => {
    m.creator.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === "keep-1"
        ? { ...KEEP, platform: "TIKTOK", handle: "@synthchannel" }
        : where.id === "drop-1"
          ? { ...DROP, platform: "INSTAGRAM", handle: "synthchannel.ig", followersCount: 900, averageViews: 0 }
          : null,
    );
    m.creatorProfileLink.findMany.mockImplementation(async ({ where }: any) =>
      where.creatorId === "keep-1" ? [{ id: "link-k", platform: "TIKTOK", handle: "synthchannel", isPrimary: true }] : [],
    );
    const dry = await (await post({ from: "drop-1", dryRun: true })).json();
    expect(dry.summary.account).toEqual({ platform: "INSTAGRAM", handle: "synthchannel.ig" });
    await post({ from: "drop-1" });
    expect(m.creatorProfileLink.createMany).toHaveBeenCalledWith({
      data: [
        {
          orgId: "org-1",
          creatorId: "keep-1",
          platform: "INSTAGRAM",
          handle: "synthchannel.ig",
          url: "https://www.instagram.com/synthchannel.ig/",
          followersCount: 900,
          averageViews: null,
          isPrimary: false,
        },
      ],
      skipDuplicates: true,
    });
  });

  it("treats a table production doesn't have as nothing to move", async () => {
    m.viewFraudFlag.count.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "P2021" }));
    expect((await post({ from: "drop-1" })).status).toBe(200);
    expect(m.viewFraudFlag.updateMany).not.toHaveBeenCalled();
  });
});
