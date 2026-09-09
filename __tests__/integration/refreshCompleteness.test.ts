/**
 * @jest-environment node
 *
 * The promise: pressing Refresh Data on a campaign updates EVERY post, not the
 * ones that happened to get a clean window.
 *
 * Measured on prod before this existed: a 58-post refresh returned 27 measured,
 * 15 backing-off, 13 refused. The 31 that missed were not bad posts -- they were
 * posts whose turn came up while a lane was walled. The run then closed and
 * nothing ever went back for them, so the campaign showed stale numbers with no
 * sign anything was outstanding. Three retry rounds inside one 260s function is
 * "try hard for four minutes", which is a different promise.
 *
 * What makes the promise keepable is that the run is RESUMABLE: a window that
 * ends with retryable posts left stays open, and a fresh invocation picks up
 * exactly those posts with a new time budget and new egress identities.
 *
 * These tests drive lib/sync/refreshCampaign directly rather than the route,
 * because the route's hand-off uses next/server `after()`, which only exists
 * inside a real request scope. The hand-off itself is covered in
 * campaignRefresh.test.ts; what is covered here is the decision it acts on.
 */
jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findMany: jest.fn() },
    campaignRefreshRun: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('@/lib/sync/syncPost', () => ({ syncPost: jest.fn() }));
jest.mock('@/lib/sounds/snapshot', () => ({ snapshotSounds: jest.fn() }));
jest.mock('@/lib/platforms/tiktokEgress', () => ({
  openTikTokPostFetcher: jest.fn(() => undefined),
}));

import { db } from '@/lib/db';
import { syncPost } from '@/lib/sync/syncPost';
import { snapshotSounds } from '@/lib/sounds/snapshot';
import { refreshCampaign } from '@/lib/sync/refreshCampaign';

/* The jest.mock factory above is the real shape; this names it so the test
   body keeps type checking without an `any` escape hatch. */
type MockedDb = {
  campaign: { findFirst: jest.Mock };
  post: { findMany: jest.Mock };
  campaignRefreshRun: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
};
const mockDb = db as unknown as MockedDb;
const mockSync = syncPost as jest.Mock;
const mockSnapshot = snapshotSounds as jest.Mock;

const ORG = 'org-1';
const CAMPAIGN = 'camp-1';

/** A campaign of `n` TikTok posts, as the refresh selects them. */
const makePosts = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `post-${offset + i}`,
    platform: 'TIKTOK',
    creatorId: `creator-${offset + i}`,
    postUrl: `https://www.tiktok.com/@x/video/${offset + i}`,
    thumbnailUrl: null,
    caption: null,
    platformMetrics: null,
  }));

/** The last data written to the run row. */
const lastRunUpdate = () => {
  const calls = mockDb.campaignRefreshRun.update.mock.calls;
  return calls[calls.length - 1][0].data;
};

/** The `where` the post query was built with, to inspect the leftover filter. */
const postQueryWhere = () => mockDb.post.findMany.mock.calls[0][0].where;

let runStartedAt: Date;

beforeEach(() => {
  jest.clearAllMocks();
  runStartedAt = new Date();

  mockDb.campaign.findFirst.mockResolvedValue({ id: CAMPAIGN, song: null });
  mockDb.campaignRefreshRun.findFirst.mockResolvedValue(null); // no cooldown
  mockDb.campaignRefreshRun.create.mockImplementation(async ({ data }: { data?: { total?: number } }) => ({
    id: 'run-1',
    startedAt: runStartedAt,
    total: data?.total ?? 0,
    status: 'running',
  }));
  mockDb.campaignRefreshRun.update.mockResolvedValue({ id: 'run-1' });
  mockSnapshot.mockResolvedValue(null);
});

/**
 * Measure the first `measured` posts and wall the rest with `reason`.
 * Stable across rounds, so a walled post stays walled -- which is what makes
 * the in-run retry give up and the CONTINUATION the only thing left.
 */
const measureFirst = (measured: number, reason = 'platform-refused') => {
  const seen = new Set<string>();
  mockSync.mockImplementation(async (post: { id: string }) => {
    seen.add(post.id);
    const idx = Number(post.id.split('-')[1]);
    return idx < measured
      ? { status: 'measured', post: {} }
      : { status: 'no-metrics', reason };
  });
  return seen;
};

describe('a window that leaves posts behind stays open', () => {
  it('reports 100 posts as continuing, not done, when only 60 were measured', async () => {
    mockDb.post.findMany.mockResolvedValue(makePosts(100));
    measureFirst(60);

    const outcome = await refreshCampaign({ orgId: ORG, campaignId: CAMPAIGN });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.total).toBe(100);
    expect(outcome.result.measured).toBe(60);
    expect(outcome.result.continuable).toBe(40);
    expect(outcome.result.continuing).toBe(true);

    const data = lastRunUpdate();
    expect(data.status).toBe('continuing');
    /* Null on purpose: finishedAt is what the button reads to stop spinning,
       and a run with another window coming has not finished. */
    expect(data.finishedAt).toBeNull();
  });

  it('closes the run the moment every post is measured', async () => {
    mockDb.post.findMany.mockResolvedValue(makePosts(100));
    measureFirst(100);

    const outcome = await refreshCampaign({ orgId: ORG, campaignId: CAMPAIGN });
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.result.measured).toBe(100);
    expect(outcome.result.continuable).toBe(0);
    expect(outcome.result.continuing).toBe(false);
    expect(lastRunUpdate().status).toBe('done');
    expect(lastRunUpdate().finishedAt).toBeInstanceOf(Date);
  });

  it('does not keep a run open for posts that are settled rather than walled', async () => {
    /* A deleted post is a real answer. Re-asking it across twenty minutes gets
       the same answer, so continuing on it would spin the run forever on
       something no window can fix. */
    mockDb.post.findMany.mockResolvedValue(makePosts(10));
    measureFirst(4, 'post-deleted');

    const outcome = await refreshCampaign({ orgId: ORG, campaignId: CAMPAIGN });
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.result.measured).toBe(4);
    expect(outcome.result.continuable).toBe(0);
    expect(outcome.result.continuing).toBe(false);
    expect(lastRunUpdate().status).toBe('done');
  });
});

describe('a continuation resumes the same run', () => {
  /** Put a resumable run in the database, started `agoMs` ago. */
  const existingRun = (agoMs: number, total: number) => {
    const startedAt = new Date(Date.now() - agoMs);
    mockDb.campaignRefreshRun.findFirst.mockResolvedValue({
      id: 'run-1',
      startedAt,
      total,
      status: 'continuing',
    });
    return startedAt;
  };

  it('asks only for posts this run has not measured', async () => {
    const startedAt = existingRun(60_000, 100);
    mockDb.post.findMany.mockResolvedValue(makePosts(40, 60));
    measureFirst(0);

    await refreshCampaign({ orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'run-1' });

    /* The leftover set is derived, not stored: syncPost stamps lastSyncedAt
       only on a real measurement, so "not measured by this run" is exactly
       "never synced, or synced before this run began". */
    expect(postQueryWhere()).toMatchObject({
      campaignId: CAMPAIGN,
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: startedAt } }],
    });
  });

  it('creates no second run row', async () => {
    existingRun(60_000, 100);
    mockDb.post.findMany.mockResolvedValue(makePosts(40, 60));
    measureFirst(0);

    await refreshCampaign({ orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'run-1' });
    expect(mockDb.campaignRefreshRun.create).not.toHaveBeenCalled();
  });

  it('carries progress forward instead of restarting the count at zero', async () => {
    /* 100-post run, 60 already measured, this window measures 25 more.
       The button must read 85 of 100, not 25 of 40. */
    existingRun(60_000, 100);
    mockDb.post.findMany.mockResolvedValue(makePosts(40, 60));
    mockSync.mockImplementation(async (post: { id: string }) => {
      const idx = Number(post.id.split('-')[1]);
      return idx < 85
        ? { status: 'measured', post: {} }
        : { status: 'no-metrics', reason: 'platform-refused' };
    });

    const outcome = await refreshCampaign({
      orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'run-1',
    });
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.result.total).toBe(100);
    expect(outcome.result.measured).toBe(85);
    expect(outcome.result.continuable).toBe(15);
    expect(lastRunUpdate().measured).toBe(85);
    expect(lastRunUpdate().completed).toBe(100);
  });

  it('never re-reads a post the previous window already measured', async () => {
    existingRun(60_000, 100);
    const leftovers = makePosts(40, 60);
    mockDb.post.findMany.mockResolvedValue(leftovers);
    measureFirst(100);

    await refreshCampaign({ orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'run-1' });

    const asked = mockSync.mock.calls.map((c) => c[0].id);
    expect(new Set(asked)).toEqual(new Set(leftovers.map((p) => p.id)));
    expect(asked).not.toContain('post-0');
  });

  it('skips the cooldown, which its own parent run would otherwise fail', async () => {
    /* The parent run is minutes old and well inside the thirty-minute gate. If
       a continuation consulted it, the refresh could never finish what it
       started -- the gate would lock out its own second window. */
    existingRun(60_000, 100);
    mockDb.post.findMany.mockResolvedValue(makePosts(40, 60));
    measureFirst(100);

    const outcome = await refreshCampaign({
      orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'run-1',
    });
    expect(outcome.ok).toBe(true);
  });

  it('stops continuing at the window cap even when the wall has time left', async () => {
    /* The wall bounds how LONG the chain runs, not how MANY windows fit in it.
       Measured before this bound existed: a 100-post window where every post
       fails retryably returns in 2ms with continuing=true -- so a fast-failing
       chain got hundreds of self-POSTs inside the twenty minutes, not four. */
    existingRun(1_000, 100); // one second in: the wall is nowhere near
    mockDb.post.findMany.mockResolvedValue(makePosts(100));
    measureFirst(0); // everything fails, retryably

    const outcome = await refreshCampaign({
      orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'run-1', window: 6,
    });
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.result.continuable).toBeGreaterThan(0);
    expect(outcome.result.continuing).toBe(false);
    expect(lastRunUpdate().status).toBe('done');
  });

  it('keeps continuing while the window count is still under the cap', async () => {
    existingRun(1_000, 100);
    mockDb.post.findMany.mockResolvedValue(makePosts(100));
    measureFirst(0);

    const outcome = await refreshCampaign({
      orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'run-1', window: 5,
    });
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.result.continuing).toBe(true);
    expect(outcome.result.window).toBe(5);
  });

  it('cannot be handed a window number that buys extra windows', async () => {
    /* A forged or malformed counter must shorten the chain or leave it alone,
       never extend it. Clamping at the cap means even Infinity terminates. */
    existingRun(1_000, 100);
    mockDb.post.findMany.mockResolvedValue(makePosts(100));
    measureFirst(0);

    for (const window of [999, Infinity, Number.NaN, -5, 0]) {
      mockDb.campaignRefreshRun.update.mockClear();
      const outcome = await refreshCampaign({
        orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'run-1', window,
      });
      if (!outcome.ok) throw new Error('expected ok');
      expect(outcome.result.window).toBeLessThanOrEqual(6);
      expect(outcome.result.window).toBeGreaterThanOrEqual(1);
    }
  });

  it('stops continuing once the wall bound is reached, and says so', async () => {
    /* The bound exists because the alternative is a refresh that spins forever
       against a WAF that has simply decided no. */
    existingRun(21 * 60 * 1000, 100);
    mockDb.post.findMany.mockResolvedValue(makePosts(40, 60));
    measureFirst(0);

    const outcome = await refreshCampaign({
      orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'run-1',
    });
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.result.continuable).toBeGreaterThan(0);
    expect(outcome.result.continuing).toBe(false);
    // Closed rather than left open forever.
    expect(lastRunUpdate().status).toBe('done');
    /* The shortfall shows up as noMetrics, not as `remaining`. `remaining`
       means "the budget never reached this post"; these forty were reached,
       asked, and refused. Conflating the two would report posts as unattempted
       that we in fact attempted several times. */
    expect(lastRunUpdate().remaining).toBe(0);
    expect(outcome.result.noMetrics).toBe(40);
    expect(outcome.result.measured).toBe(60);
  });

  it('refuses to resume a run belonging to another campaign or org', async () => {
    // Scoped lookup finds nothing, so the id names no run this caller may touch.
    mockDb.campaignRefreshRun.findFirst.mockResolvedValue(null);
    mockDb.post.findMany.mockResolvedValue(makePosts(10));

    const outcome = await refreshCampaign({
      orgId: ORG, campaignId: CAMPAIGN, resumeRunId: 'someone-elses-run',
    });
    expect(outcome).toEqual({ ok: false, reason: 'not-found' });
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe('end to end: 100 posts across windows', () => {
  it('measures every post when the walls clear on a later window', async () => {
    /* Window 1 measures 60 of 100 and leaves the run open. Window 2 is handed
       the 40 leftovers -- with fresh egress identities, which is the thing that
       actually changes a walled post's odds -- and measures them all. */
    mockDb.post.findMany.mockResolvedValueOnce(makePosts(100));
    measureFirst(60);
    const first = await refreshCampaign({ orgId: ORG, campaignId: CAMPAIGN });
    if (!first.ok) throw new Error('expected ok');
    expect(first.result.measured).toBe(60);
    expect(first.result.continuing).toBe(true);

    mockDb.campaignRefreshRun.findFirst.mockResolvedValue({
      id: 'run-1', startedAt: runStartedAt, total: 100, status: 'continuing',
    });
    mockDb.post.findMany.mockResolvedValueOnce(makePosts(40, 60));
    measureFirst(100);
    const second = await refreshCampaign({
      orgId: ORG, campaignId: CAMPAIGN, resumeRunId: first.result.runId,
    });
    if (!second.ok) throw new Error('expected ok');

    expect(second.result.total).toBe(100);
    expect(second.result.measured).toBe(100);
    expect(second.result.continuable).toBe(0);
    expect(second.result.continuing).toBe(false);
    expect(second.result.remaining).toBe(0);
    expect(lastRunUpdate().status).toBe('done');
  });
});
