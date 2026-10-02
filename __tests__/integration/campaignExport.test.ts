/**
 * @jest-environment node
 *
 * The campaign export is the dashboard in a file, so it has to answer the same
 * questions the dashboard does. Four places where it did not:
 *
 *  - Posts sheet multiplied an already-percentage engagement rate by 100 again;
 *  - Summary counted creators as activations while the Creators sheet counted
 *    the union of activation and post creators;
 *  - raw counters were emitted for posts nobody ever fetched;
 *  - the Creators sheet rated every post, measured or not.
 */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/campaigns/[id]/export/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findMany: jest.fn() },
    activation: { findMany: jest.fn() },
  },
}));
// @react-pdf/renderer ships ESM this config cannot parse, and the CSV path
// never renders a PDF anyway.
jest.mock('@react-pdf/renderer', () => ({ renderToBuffer: jest.fn() }));
jest.mock('@/lib/reports/CampaignPerformancePDF', () => ({ CampaignPerformancePDF: () => null }));
jest.mock('@/lib/authenticate', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/campaignScope', () => ({ campaignScopeWhereFor: jest.fn().mockReturnValue({}) }));
jest.mock('@/lib/reports/campaignPerformance', () => ({ computeCampaignPerformance: jest.fn() }));

import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/authenticate';
import { computeCampaignPerformance } from '@/lib/reports/campaignPerformance';

const mockDb = db as any;
const mockAuth = authenticateRequest as jest.Mock;
const mockPerformance = computeCampaignPerformance as jest.Mock;

const call = (id = 'camp-1', format = 'csv') =>
  GET(new NextRequest(`http://localhost/api/campaigns/${id}/export?format=${format}`), {
    params: Promise.resolve({ id }),
  });

/** The CSV is three named sections concatenated; this pulls one of them out. */
function section(csv: string, name: string): string {
  const parts = csv.split(/^(Summary|Posts|Creators)$/m);
  const at = parts.indexOf(name);
  return at === -1 ? '' : parts[at + 1];
}

const measuredPost = (over: Record<string, unknown> = {}) => ({
  platform: 'TIKTOK',
  postUrl: 'https://www.tiktok.com/@a/video/1',
  postedAt: new Date('2026-08-01T00:00:00Z'),
  status: 'LIVE',
  viewsCount: 1000,
  likesCount: 40,
  commentsCount: 2,
  sharesCount: 1,
  savesCount: 0,
  downloadsCount: 0,
  engagementRate: 4.3,
  lastSyncedAt: new Date('2026-08-02T00:00:00Z'),
  platformMetrics: null,
  creator: { id: 'cr-1', name: 'Awx Yken', handle: 'awxyken', platform: 'TIKTOK' },
  ...over,
});

const performance = (over: Record<string, unknown> = {}) => ({
  currency: 'USD',
  kpis: { views: 1000, engagements: 43, engagementRate: 0.043 },
  platformSplit: [{ platform: 'TIKTOK', posts: 1, views: 1000 }],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ orgId: 'org-1' });
  mockDb.campaign.findFirst.mockResolvedValue({
    id: 'camp-1',
    orgId: 'org-1',
    title: 'Leak It',
    status: 'IN_PROGRESS',
    budget: 5000,
    currency: 'USD',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    client: { name: 'Acme' },
  });
  mockPerformance.mockResolvedValue(performance());
  mockDb.post.findMany.mockResolvedValue([measuredPost()]);
  mockDb.activation.findMany.mockResolvedValue([]);
});

it('returns 401 without a session', async () => {
  mockAuth.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
});

it('writes the stored engagement rate as a percent, not a percent x 100', async () => {
  const csv = await (await call()).text();
  const posts = section(csv, 'Posts');

  // 40 likes + 2 comments over 1000 views is 4.20%, not 420%. The rate is
  // followed by the appended As of / Source / Post status columns.
  expect(posts).toContain(',4.2,');
  expect(posts).not.toContain(',420');
});

it('counts creators the same way in the Summary and the Creators sheet', async () => {
  // An imported campaign: posts from two creators, no activations at all.
  mockDb.post.findMany.mockResolvedValue([
    measuredPost(),
    measuredPost({ creator: { id: 'cr-2', name: 'Bo Yang', handle: 'boyang', platform: 'TIKTOK' } }),
  ]);

  const csv = await (await call()).text();

  expect(section(csv, 'Summary')).toContain('Creators,2');
  const creatorRows = section(csv, 'Creators').trim().split('\n');
  // header + one row per creator
  expect(creatorRows).toHaveLength(3);
});

it('writes an unmeasured counter as — instead of 0, and says it was never read', async () => {
  mockDb.post.findMany.mockResolvedValue([
    measuredPost({ likesCount: 0, commentsCount: 0, sharesCount: 0, savesCount: 0, lastSyncedAt: null }),
  ]);

  const row = section(await (await call()).text(), 'Posts').trim().split('\n')[1];
  // views, four unknown counters, an unknown rate, then no read time, no
  // source and a status that does not claim the post is live.
  expect(row.endsWith('1000,—,—,—,—,—,—,Not read,Unverified')).toBe(true);
});

it('rates a creator over measured posts only', async () => {
  mockDb.post.findMany.mockResolvedValue([
    measuredPost(),
    // Never fetched: its zeroes must not dilute the creator's rate.
    measuredPost({
      postUrl: 'https://www.tiktok.com/@a/video/2',
      viewsCount: 9000,
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      savesCount: 0,
      lastSyncedAt: null,
    }),
  ]);

  const row = section(await (await call()).text(), 'Creators').trim().split('\n')[1];
  // 43 engagements over the 1,000 measured views = 4.30%, not 43/10,000 = 0.43%.
  // Engagement Rate % is followed by the appended As of / Source / Post status.
  expect(row).toMatch(/,4\.3,2026-08-02T00:00:00\.000Z,/);
  expect(row).not.toMatch(/,0\.43,/);
});

/* EMV was removed from the product. The export is the one artifact that leaves
   the building, so it is the one worth pinning: no label, no column, no
   modelled figure, whatever the campaign's currency. */
it('carries no EMV anywhere in the export', async () => {
  mockPerformance.mockResolvedValue(performance({ currency: 'INR' }));

  const csv = await (await call()).text();

  expect(csv).not.toContain('EMV');
  // The rest of the export is untouched -- this removed one column, not a sheet.
  expect(section(csv, 'Summary')).toContain('Views,');
  expect(section(csv, 'Creators')).toContain('Engagement Rate %');
});

/* Plan A2/A6/A5: the file says how fresh it is, and every row says when it was
   read, by what, and whether the post is still up -- all appended, so the
   columns a saved import reads by position do not move. */
describe('age, source and post status', () => {
  const POST_HEADER =
    'Posted At,Creator,Handle,Platform,Status,URL,Views,Likes,Comments,Shares,Saves,Engagement Rate %';
  const CREATOR_HEADER =
    'Creator,Handle,Platform,Activation Status,Due Date,Posts,Views,Engagements,Engagement Rate %';

  it('stamps the Summary with the newest reading behind it', async () => {
    mockDb.post.findMany.mockResolvedValue([
      measuredPost(),
      measuredPost({ postUrl: 'https://www.tiktok.com/@a/video/2', lastSyncedAt: new Date('2026-09-30T06:00:00Z') }),
      measuredPost({ postUrl: 'https://www.tiktok.com/@a/video/3', lastSyncedAt: null }),
    ]);

    const summary = section(await (await call()).text(), 'Summary');
    expect(summary).toContain('Data as of,2026-09-30T06:00:00.000Z');
  });

  it('says "—" for Data as of when nothing has been read', async () => {
    mockDb.post.findMany.mockResolvedValue([measuredPost({ lastSyncedAt: null })]);
    expect(section(await (await call()).text(), 'Summary')).toContain('Data as of,—');
  });

  it('appends As of, Source and Post status after every existing column', async () => {
    const csv = await (await call()).text();
    const [postHeader, postRow] = section(csv, 'Posts').trim().split('\n');
    expect(postHeader).toBe(`${POST_HEADER},As of,Source,Post status`);
    expect(postRow.endsWith(',4.2,2026-08-02T00:00:00.000Z,Platform read,Live')).toBe(true);

    const [creatorHeader, creatorRow] = section(csv, 'Creators').trim().split('\n');
    expect(creatorHeader).toBe(`${CREATOR_HEADER},As of,Source,Post status`);
    expect(creatorRow.endsWith(',2026-08-02T00:00:00.000Z,Campaign posts,All live')).toBe(true);
  });

  it('keeps a hidden post\'s last numbers and calls it hidden', async () => {
    mockDb.post.findMany.mockResolvedValue([
      measuredPost({
        platformMetrics: { __lastFetch: { reason: 'post-hidden', at: '2026-08-05T00:00:00.000Z', via: 'cron' } },
      }),
    ]);

    const row = section(await (await call()).text(), 'Posts').trim().split('\n')[1];
    // The views it earned are still there, read when they were read.
    expect(row).toContain(',1000,40,2,1,');
    expect(row.endsWith(',2026-08-02T00:00:00.000Z,Platform read,Hidden')).toBe(true);
  });

  it('calls a post deleted only after two checks said so', async () => {
    const gone = (strikes: number) =>
      measuredPost({
        fetchState: 'UNAVAILABLE',
        platformMetrics: {
          __lastFetch: { reason: 'post-deleted', at: '2026-08-06T00:00:00.000Z', since: '2026-08-05T00:00:00.000Z', strikes, via: 'cron' },
        },
      });

    mockDb.post.findMany.mockResolvedValue([gone(1)]);
    let row = section(await (await call()).text(), 'Posts').trim().split('\n')[1];
    expect(row.endsWith(',Platform read,Unverified since 2 Aug 2026')).toBe(true);

    mockDb.post.findMany.mockResolvedValue([gone(2)]);
    row = section(await (await call()).text(), 'Posts').trim().split('\n')[1];
    expect(row.endsWith(',Platform read,Deleted')).toBe(true);
  });

  it('dates an imported post by the import, and says so', async () => {
    mockDb.post.findMany.mockResolvedValue([
      measuredPost({ lastSyncedAt: null, fetchState: 'LIVE', lastFreshAt: new Date('2026-07-20T00:00:00Z') }),
    ]);

    const row = section(await (await call()).text(), 'Posts').trim().split('\n')[1];
    expect(row.endsWith(',2026-07-20T00:00:00.000Z,CreatorCore import,Live')).toBe(true);
  });
});
