/**
 * @jest-environment node
 *
 * The rule under test: a refresh that fetched nothing must leave the post
 * looking unfetched. Every counter is a Float defaulting to 0, so lastSyncedAt
 * is the only thing telling "no likes" apart from "never looked" (see
 * lib/metricDisplay). Stamping it on an empty fetch -- which is what every
 * TikTok fetch is from a network where TikTok is blocked -- turns a campaign's
 * worth of unknowns into measured zeroes, permanently.
 */
import { NextRequest } from 'next/server';
import { POST as SYNC_ONE } from '@/app/api/campaigns/[id]/posts/[postId]/sync/route';
import { POST as REFRESH_ALL } from '@/app/api/campaigns/[id]/refresh/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    creator: { update: jest.fn() },
    postMetricSnapshot: { create: jest.fn() },
    campaignRefreshRun: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/platforms/fetchPostMetrics', () => ({
  ...jest.requireActual('@/lib/platforms/fetchPostMetrics'),
  fetchPostMetrics: jest.fn(),
}));
jest.mock('@/lib/platforms/instagramToken', () => ({ getInstagramAccountForCreator: jest.fn() }));
jest.mock('@/lib/platforms/tiktokToken', () => ({ getTikTokTokenForCreator: jest.fn() }));
jest.mock('@/lib/sounds/snapshot', () => ({ snapshotSounds: jest.fn() }));
/* The refresh cooldown is no longer an in-memory counter -- it is the newest
   CampaignRefreshRun row, which is why it survives a reload and applies to the
   MCP server too. Tests drive it by what campaignRefreshRun.findFirst returns. */
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(), rateLimitKey: jest.fn() }));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { fetchPostMetrics } from '@/lib/platforms/fetchPostMetrics';
import { snapshotSounds } from '@/lib/sounds/snapshot';
import { rateLimit } from '@/lib/rateLimit';

const mockDb = db as any;
const mockAuth = auth as jest.Mock;
const mockFetch = fetchPostMetrics as jest.Mock;
const mockSnapshot = snapshotSounds as jest.Mock;
const mockRateLimit = rateLimit as jest.Mock;

const session = { user: { id: 'u1', orgId: 'org-1' } };
const post = {
  id: 'post-1',
  platform: 'TIKTOK',
  creatorId: 'creator-1',
  postUrl: 'https://www.tiktok.com/@x/video/123',
  thumbnailUrl: null,
  caption: null,
};

/** What a blocked or unhelpful platform returns: media fields, no counts. */
const noCounts = {
  platform: 'TIKTOK',
  platformPostId: '123',
  thumbnailUrl: null,
  caption: null,
  postedAt: new Date('2026-08-01'),
};
const withCounts = { ...noCounts, viewsCount: 900, likesCount: 40, commentsCount: 5, sharesCount: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', song: null });
  mockDb.post.findFirst.mockResolvedValue(post);
  mockDb.post.findMany.mockResolvedValue([post]);
  mockDb.post.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'post-1', ...data }));
  mockDb.$transaction.mockImplementation((ops: any[]) => Promise.resolve(ops));
  mockSnapshot.mockResolvedValue({ snapshots: 1, failed: 0, skipped: 0 });
  mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  // No prior run: the campaign is free to refresh. Tests that care override it.
  mockDb.campaignRefreshRun.findFirst.mockResolvedValue(null);
  mockDb.campaignRefreshRun.create.mockResolvedValue({ id: 'run-1' });
  mockDb.campaignRefreshRun.update.mockResolvedValue({ id: 'run-1' });
});

const syncReq = () =>
  SYNC_ONE(new NextRequest('http://localhost/api/campaigns/camp-1/posts/post-1/sync', { method: 'POST' }), {
    params: Promise.resolve({ id: 'camp-1', postId: 'post-1' }),
  });

const refreshReq = () =>
  REFRESH_ALL(new NextRequest('http://localhost/api/campaigns/camp-1/refresh', { method: 'POST' }), {
    params: Promise.resolve({ id: 'camp-1' }),
  });

describe('single post sync', () => {
  it('does not stamp lastSyncedAt when the platform returned no counts', async () => {
    mockFetch.mockResolvedValue(noCounts);

    const res = await syncReq();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.metricsFound).toBe(false);
    const written = mockDb.post.update.mock.calls[0][0].data;
    expect(written).not.toHaveProperty('lastSyncedAt');
    // Nor may it write the zeroes themselves.
    expect(written).not.toHaveProperty('viewsCount');
    expect(mockDb.postMetricSnapshot.create).not.toHaveBeenCalled();
  });

  it('stamps lastSyncedAt and snapshots when counts came back', async () => {
    mockFetch.mockResolvedValue(withCounts);

    const res = await syncReq();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.metricsFound).toBe(true);
    expect(mockDb.$transaction).toHaveBeenCalled();
    const written = mockDb.post.update.mock.calls[0][0].data;
    expect(written.lastSyncedAt).toBeInstanceOf(Date);
    expect(written.viewsCount).toBe(900);
    expect(mockDb.postMetricSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ postId: 'post-1', viewsCount: 900 }) }),
    );
  });

  it('writes only the counters the platform reported, and records which', async () => {
    // Instagram's shape: views and comments, no likes, no shares. The old code
    // filled all four with `?? 0` and stamped the timestamp, so a report showed
    // "0 likes, 0 shares" for a post where the platform said neither.
    mockFetch.mockResolvedValue({
      platform: 'INSTAGRAM',
      platformPostId: 'abc',
      thumbnailUrl: null,
      caption: null,
      postedAt: new Date('2026-08-01'),
      viewsCount: 9864,
      commentsCount: 2,
    });

    await syncReq();
    const written = mockDb.post.update.mock.calls[0][0].data;

    expect(written.viewsCount).toBe(9864);
    expect(written.commentsCount).toBe(2);
    expect(written).not.toHaveProperty('likesCount');
    expect(written).not.toHaveProperty('sharesCount');
    expect(written.platformMetrics.__measured).toEqual(['views', 'comments']);
  });

  it('keeps the importer raw record when it merges the measured list in', async () => {
    // platformMetrics is a shared bag: cc-import parks the whole CreatorCore
    // record under __cc there, and overwriting it would throw that away.
    mockDb.post.findFirst.mockResolvedValue({
      ...post,
      platformMetrics: { __cc: { id: 'cc-1' }, __stat: { views: 12 } },
    });
    mockFetch.mockResolvedValue(withCounts);

    await syncReq();
    const written = mockDb.post.update.mock.calls[0][0].data;

    expect(written.platformMetrics.__cc).toEqual({ id: 'cc-1' });
    expect(written.platformMetrics.__stat).toEqual({ views: 12 });
    expect(written.platformMetrics.__measured).toEqual(['views', 'likes', 'comments', 'shares']);
  });

  it("fills in the author's follower count from the same fetch", async () => {
    // TikTok reports authorStats in the post payload, so this costs no extra
    // request. Nothing had ever written Creator.followersCount, which is why the
    // campaign roster showed 0 followers for all 25 of them.
    mockFetch.mockResolvedValue({ ...withCounts, authorFollowers: 22700 });

    await syncReq();

    expect(mockDb.creator.update).toHaveBeenCalledWith({
      where: { id: 'creator-1' },
      data: { followersCount: 22700 },
    });
  });

  it('leaves a stored follower count alone when the platform did not report one', async () => {
    // Only ever upward from nothing: a payload without authorStats must not
    // overwrite a figure an earlier sync or the import already established.
    mockFetch.mockResolvedValue(withCounts);
    await syncReq();
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it('does not write a follower count of zero', async () => {
    mockFetch.mockResolvedValue({ ...withCounts, authorFollowers: 0 });
    await syncReq();
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it('marks a post live when the platform answered, and never the reverse', async () => {
    mockFetch.mockResolvedValue(withCounts);
    await syncReq();
    expect(mockDb.post.update.mock.calls[0][0].data.fetchState).toBe('LIVE');

    // A fetch that came back with nothing is our network far more often than a
    // deleted post -- every TikTok fetch fails from here -- so it says nothing.
    jest.clearAllMocks();
    mockDb.post.findFirst.mockResolvedValue(post);
    mockDb.post.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'post-1', ...data }));
    mockFetch.mockResolvedValue(noCounts);
    await syncReq();
    expect(mockDb.post.update.mock.calls[0][0].data).not.toHaveProperty('fetchState');
  });

  it('reports an unusable URL as 422 rather than a silent success', async () => {
    mockFetch.mockResolvedValue(null);

    const res = await syncReq();

    expect(res.status).toBe(422);
    expect(mockDb.post.update).not.toHaveBeenCalled();
  });
});

describe('campaign-wide refresh', () => {
  it('counts what it could not measure instead of returning a bare ok', async () => {
    mockFetch.mockResolvedValue(noCounts);

    const res = await refreshReq();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ total: 1, measured: 0, noMetrics: 1, failed: 0 });
  });

  it('refreshes the campaign audio in the same run when a sound is tracked', async () => {
    mockFetch.mockResolvedValue(withCounts);
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', song: { soundId: 'sound-1' } });

    const res = await refreshReq();
    const body = await res.json();

    expect(body.measured).toBe(1);
    // Scoped to that one sound, not the whole org's trackers.
    expect(mockSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', soundId: 'sound-1' }),
    );
  });

  it('leaves the audio alone when the campaign promotes no tracked sound', async () => {
    mockFetch.mockResolvedValue(withCounts);

    const body = await (await refreshReq()).json();

    expect(body.sound).toBeNull();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it('keeps going when one post throws', async () => {
    mockDb.post.findMany.mockResolvedValue([post, { ...post, id: 'post-2' }]);
    mockFetch.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(withCounts);

    const body = await (await refreshReq()).json();

    expect(body).toMatchObject({ total: 2, measured: 1, failed: 1 });
  });

  it('turns a held-down button away instead of re-fetching every post', async () => {
    /* Started a minute ago, so 29 of the 30 minutes are left. The old limiter
       kept this in a Map inside one process and handed every cold start a
       fresh allowance; a row is the same answer everywhere. */
    mockDb.campaignRefreshRun.findFirst.mockResolvedValue({
      id: 'run-0', status: 'done',
      startedAt: new Date(Date.now() - 60 * 1000),
      finishedAt: new Date(Date.now() - 30 * 1000),
      total: 1, completed: 1, measured: 1,
      noMetrics: 0, unfetchable: 0, failed: 0, remaining: 0, reasons: {},
    });

    const res = await refreshReq();
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toContain('Please wait 29 mins');
    expect(res.headers.get('Retry-After')).toBe(String(29 * 60));
    // Nothing was fetched: the point of the gate is the requests it prevents.
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
  });

  it('refuses a campaign in another org', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);

    const res = await refreshReq();

    expect(res.status).toBe(404);
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
  });
});
