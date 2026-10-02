/**
 * @jest-environment node
 *
 * Track all / Track selected / Track this campaign's creators (plan §12 F2/F3).
 *
 * What has to hold, in the order it would hurt if it did not:
 * - two clicks cannot both add: the second finds the agency's lock taken;
 * - the plan's limit is respected, counted the way the single add counts it;
 * - new rows join the BACK of the reading queue (last attempt = now);
 * - the org is the session's, and an id from another workspace is not tracked;
 * - Track all stays shut until reader v2 reads this whole workspace.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => {
  const db: Record<string, unknown> = {
    creator: { count: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    tikTokSound: { count: jest.fn() },
    organization: { findUnique: jest.fn() },
    campaign: { findFirst: jest.fn() },
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
  };
  // The transaction client is the same mock, so a count made through it is
  // the count the assertions read.
  (db.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  return { db };
});
// getAuditActor as lib/authenticate writes it; the real module pulls in NextAuth.
jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(),
  getAuditActor: (r: { userId: string | null; actorEmail: string | null; actorType: string }) => ({
    userId: r.userId ?? undefined,
    actorEmail: r.actorEmail ?? undefined,
    actorType: r.actorType,
  }),
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/trackers/sourceSwitch", () => ({
  ...jest.requireActual("@/lib/trackers/sourceSwitch"),
  resolveTrackerPlan: jest.fn(),
}));
jest.mock("@/lib/creators/rosterSelection", () => ({
  MAX_BULK_CREATORS: 5000,
  resolveRosterSelection: jest.fn(),
}));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { resolveTrackerPlan, type ResolvedTrackerPlan } from "@/lib/trackers/sourceSwitch";
import { resolveRosterSelection } from "@/lib/creators/rosterSelection";
import { orgFixture } from "../helpers/orgFixture";
import { GET, POST } from "@/app/api/trackers/creators/bulk/route";
import { BULK_TRACK_UNGATED_MAX } from "@/lib/trackers/trackAll";

const mockDb = db as any;
const mockAuth = authenticateRequest as jest.Mock;
const mockPlan = resolveTrackerPlan as jest.Mock;
const mockAudit = logAudit as jest.Mock;

const URL = "http://localhost:3009/api/trackers/creators/bulk";
const post = (body: unknown) =>
  new NextRequest(URL, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const plan = (over: Partial<ResolvedTrackerPlan> = {}): ResolvedTrackerPlan => ({
  position: "A",
  effective: "A",
  scopeOrgIds: [],
  percent: 100,
  changedAt: null,
  changedBy: null,
  reason: null,
  ...over,
});
const LEGACY = plan({ position: "legacy", effective: "legacy" });

/**
 * The three counts the route makes, told apart by their where clause:
 * the selection, the selection's already-tracked part (an AND), and the
 * org's whole tracked pool (lib/trackers/limit.ts).
 */
let counts = { requested: 0, alreadyTracked: 0, trackedInOrg: 0, sounds: 0 };
function setCounts(next: Partial<typeof counts>) {
  counts = { ...counts, ...next };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockDb));
  mockAuth.mockResolvedValue({ orgId: "org-1", userId: "u1", actorEmail: null, actorType: "user", role: "ADMIN", campaignScope: "ALL" });
  mockPlan.mockResolvedValue(plan());
  mockDb.organization.findUnique.mockResolvedValue(orgFixture({ plan: "pro", planConfig: { maxTrackers: 4000 } }));
  mockDb.$queryRawUnsafe.mockResolvedValue([{ locked: true }]);
  counts = { requested: 2566, alreadyTracked: 1850, trackedInOrg: 1850, sounds: 7 };
  mockDb.creator.count.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    if ("AND" in where) return Promise.resolve(counts.alreadyTracked);
    if ("trackedSince" in where) return Promise.resolve(counts.trackedInOrg);
    return Promise.resolve(counts.requested);
  });
  mockDb.tikTokSound.count.mockImplementation(() => Promise.resolve(counts.sounds));
  mockDb.creator.findMany.mockImplementation(({ take }: { take: number }) =>
    Promise.resolve(Array.from({ length: take }, (_, i) => ({ id: `cr-${i}` })))
  );
  mockDb.creator.updateMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve({ count: where.id.in.length })
  );
});

describe("POST /api/trackers/creators/bulk -- who may call it", () => {
  it("refuses an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST(post({ scope: "all" }))).status).toBe(401);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a viewer, who can read trackers but not start hundreds", async () => {
    mockAuth.mockResolvedValue({ orgId: "org-1", userId: "u2", actorType: "user", role: "VIEWER", campaignScope: "ALL" });
    expect((await POST(post({ scope: "all" }))).status).toBe(403);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a body that names nothing", async () => {
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ scope: "everything" }))).status).toBe(400);
    expect((await POST(post({ creatorIds: [] }))).status).toBe(400);
  });
});

describe("the per-agency lock", () => {
  it("answers 409 and writes nothing when another Track all holds it", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ locked: false }]);
    const res = await POST(post({ scope: "all" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("track_bulk_busy");
    expect(body.message).toMatch(/Another Track all is running/);
    expect(mockDb.creator.findMany).not.toHaveBeenCalled();
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
  });

  it("takes a transaction-scoped try-lock keyed on the session's org", async () => {
    await POST(post({ scope: "all", orgId: "org-evil" }));
    const [sql, key] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("pg_try_advisory_xact_lock(hashtext('track-bulk:' || $1))");
    expect(key).toBe("org-1");
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("the limit", () => {
  it("adds every untracked creator when the room covers them", async () => {
    // 4,000 allowed; 1,850 creators + 7 sounds in use; 716 not yet tracked.
    const res = await POST(post({ scope: "all" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      requested: 2566,
      added: 716,
      alreadyTracked: 1850,
      skippedForLimit: 0,
      roomLeft: 4000 - 1857 - 716,
      limit: 4000,
      tracked: 1857 + 716,
      limitMessage: null,
    });
    expect(mockDb.creator.findMany.mock.calls[0][0].take).toBe(716);
  });

  it("adds only the room left, and says how many it could not", async () => {
    mockDb.organization.findUnique.mockResolvedValue(orgFixture({ plan: "pro", planConfig: { maxTrackers: 2000 } }));
    const body = await (await POST(post({ scope: "all" }))).json();
    expect(body).toMatchObject({ added: 143, skippedForLimit: 716 - 143, roomLeft: 0, limit: 2000 });
    expect(body.limitMessage).toBe(
      "Your plan includes 2000 trackers and 2000 are in use. Remove one, or ask us to raise the limit."
    );
    expect(mockDb.creator.findMany.mock.calls[0][0].take).toBe(143);
  });

  it("falls back to pro's 100 without an override, and adds nothing past it", async () => {
    mockDb.organization.findUnique.mockResolvedValue(orgFixture({ plan: "pro" }));
    const body = await (await POST(post({ scope: "all" }))).json();
    expect(body).toMatchObject({ added: 0, skippedForLimit: 716, roomLeft: 0, limit: 100 });
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("counts sounds and creators as one pool, the way the single add does", async () => {
    mockDb.organization.findUnique.mockResolvedValue(orgFixture({ plan: "pro", planConfig: { maxTrackers: 1900 } }));
    setCounts({ sounds: 40 });
    const body = await (await POST(post({ scope: "all" }))).json();
    expect(body.added).toBe(1900 - 1850 - 40);
  });

  it("reports no limit on a plan without one", async () => {
    mockDb.organization.findUnique.mockResolvedValue(orgFixture({ plan: "enterprise" }));
    const body = await (await POST(post({ scope: "all" }))).json();
    expect(body).toMatchObject({ added: 716, roomLeft: null, limit: null, skippedForLimit: 0 });
  });
});

describe("new rows join the back of the reading queue", () => {
  it("stamps trackedSince and trackerLastAttemptAt with the same now", async () => {
    await POST(post({ scope: "all" }));
    const { data, where } = mockDb.creator.updateMany.mock.calls[0][0];
    expect(data.trackedSince).toBeInstanceOf(Date);
    expect(data.trackerLastAttemptAt).toBeInstanceOf(Date);
    expect(data.trackerLastAttemptAt.getTime()).toBe(data.trackedSince.getTime());
    // A creator tracked by hand in the meantime keeps the date it was given.
    expect(where).toMatchObject({ orgId: "org-1", deletedAt: null, trackedSince: null });
  });

  it("picks the oldest creators on the roster first, in a total order", async () => {
    await POST(post({ scope: "all" }));
    const args = mockDb.creator.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ addedAt: "asc" }, { id: "asc" }]);
    expect(args.where).toEqual({ AND: [{ orgId: "org-1", deletedAt: null }, { trackedSince: null }] });
  });
});

describe("tenancy", () => {
  it("resolves Track selected inside the session's org; a foreign id is counted as not found", async () => {
    setCounts({ requested: 1, alreadyTracked: 0 });
    const res = await POST(post({ creatorIds: ["cr-mine", "cr-theirs"] }));
    const body = await res.json();
    expect(body).toMatchObject({ requested: 1, added: 1, notFound: 1 });
    const countWhere = mockDb.creator.count.mock.calls[0][0].where;
    expect(countWhere).toEqual({ orgId: "org-1", deletedAt: null, id: { in: ["cr-mine", "cr-theirs"] } });
    expect(mockDb.creator.findMany.mock.calls[0][0].where.AND[0]).toEqual(countWhere);
    expect(mockDb.creator.updateMany.mock.calls[0][0].where.orgId).toBe("org-1");
  });

  it("finds the campaign in the session's org, honouring an assigned-only scope", async () => {
    mockAuth.mockResolvedValue({ orgId: "org-1", userId: "u3", actorType: "user", role: "MANAGER", campaignScope: "ASSIGNED" });
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const res = await POST(post({ campaignId: "camp-other" }));
    expect(res.status).toBe(404);
    const where = mockDb.campaign.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "camp-other", orgId: "org-1", deletedAt: null });
    expect(where.OR).toBeDefined();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("takes a campaign's creators from its activations and its posts", async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1", title: "Spring launch" });
    setCounts({ requested: 12, alreadyTracked: 4 });
    const body = await (await POST(post({ campaignId: "camp-1" }))).json();
    expect(body).toMatchObject({ requested: 12, added: 8, alreadyTracked: 4 });
    expect(mockDb.creator.count.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      deletedAt: null,
      OR: [
        { activations: { some: { campaignId: "camp-1", deletedAt: null } } },
        { posts: { some: { campaignId: "camp-1" } } },
      ],
    });
  });

  it("resolves 'all matching' through the roster's own selection, scoped to the session's org", async () => {
    (resolveRosterSelection as jest.Mock).mockResolvedValue({ ok: true, ids: ["a", "b"] });
    setCounts({ requested: 2, alreadyTracked: 0 });
    await POST(post({ query: "platform=TIKTOK" }));
    expect(resolveRosterSelection).toHaveBeenCalledWith("org-1", { query: "platform=TIKTOK" });
    expect(mockDb.creator.count.mock.calls[0][0].where).toEqual({ orgId: "org-1", deletedAt: null, id: { in: ["a", "b"] } });
  });
});

describe("the gate: Track all opens only where reader v2 owns the agency", () => {
  it.each([
    ["the switch is on legacy", LEGACY],
    ["reader v2 is scoped to other agencies", plan({ scopeOrgIds: ["org-2"] })],
    ["the rollout is below 100%", plan({ percent: 60 })],
  ])("refuses Track all when %s", async (_label, resolved) => {
    mockPlan.mockResolvedValue(resolved);
    const res = await POST(post({ scope: "all" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "track_all_closed",
      message: "Track all opens once the new reader runs for this workspace.",
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("opens for an agency named in the scope at 100%", async () => {
    mockPlan.mockResolvedValue(plan({ position: "B", effective: "B", scopeOrgIds: ["org-1"] }));
    expect((await POST(post({ scope: "all" }))).status).toBe(200);
  });

  it(`lets Track selected add up to ${BULK_TRACK_UNGATED_MAX} while it is shut`, async () => {
    mockPlan.mockResolvedValue(LEGACY);
    setCounts({ requested: 40, alreadyTracked: 40 - BULK_TRACK_UNGATED_MAX });
    const res = await POST(post({ creatorIds: Array.from({ length: 40 }, (_, i) => `id-${i}`) }));
    expect(res.status).toBe(200);
    expect((await res.json()).added).toBe(BULK_TRACK_UNGATED_MAX);
  });

  it("refuses a selection that would add more, and writes nothing", async () => {
    mockPlan.mockResolvedValue(LEGACY);
    setCounts({ requested: 40, alreadyTracked: 0 });
    const res = await POST(post({ creatorIds: Array.from({ length: 40 }, (_, i) => `id-${i}`) }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("track_all_closed");
    expect(body.message).toContain("That would add 40 creators");
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
  });

  it("measures the campaign threshold on rows it would add, after the limit", async () => {
    mockPlan.mockResolvedValue(LEGACY);
    mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1", title: "Big" });
    mockDb.organization.findUnique.mockResolvedValue(orgFixture({ plan: "pro", planConfig: { maxTrackers: 1867 } }));
    setCounts({ requested: 300, alreadyTracked: 0 });
    // 300 untracked, but only 10 trackers left: 10 is under the threshold.
    const res = await POST(post({ campaignId: "camp-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: 10, skippedForLimit: 290 });
  });
});

describe("the audit log", () => {
  it("records what Track all added, with the ids, so it can be undone", async () => {
    setCounts({ requested: 1853, alreadyTracked: 1850 });
    await POST(post({ scope: "all" }));
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const entry = mockAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      orgId: "org-1",
      userId: "u1",
      action: "tracker.creators_track",
      entityType: "creator_tracker",
      entityLabel: "Track all",
      metadata: { scope: "all", requested: 1853, added: 3, alreadyTracked: 1850, skippedForLimit: 0 },
    });
    expect(entry.metadata.creatorIds).toEqual(["cr-0", "cr-1", "cr-2"]);
  });

  it("writes nothing to it when nothing was added", async () => {
    setCounts({ requested: 1850, alreadyTracked: 1850 });
    const body = await (await POST(post({ scope: "all" }))).json();
    expect(body).toMatchObject({ added: 0, alreadyTracked: 1850 });
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("GET /api/trackers/creators/bulk", () => {
  const get = () => GET(new NextRequest(URL));

  it("refuses an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it("tells the roster whether Track all is open and how much room is left", async () => {
    setCounts({ requested: 2566 });
    const body = await (await get()).json();
    expect(body).toEqual({
      trackAllOpen: true,
      reason: null,
      ungatedMax: BULK_TRACK_UNGATED_MAX,
      roster: 2566,
      untracked: 716,
      tracked: 1857,
      limit: 4000,
      roomLeft: 2143,
      limitMessage: null,
    });
  });

  it("gives the reason while it is shut, and the limit sentence when the plan is full", async () => {
    mockPlan.mockResolvedValue(LEGACY);
    mockDb.organization.findUnique.mockResolvedValue(orgFixture({ plan: "pro" }));
    const body = await (await get()).json();
    expect(body).toMatchObject({
      trackAllOpen: false,
      reason: "Track all opens once the new reader runs for this workspace.",
      roomLeft: 0,
      limit: 100,
    });
    expect(body.limitMessage).toContain("Your plan includes 100 trackers");
  });
});
