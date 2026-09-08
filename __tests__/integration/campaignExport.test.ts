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
 *
 * And EMV is a USD figure whatever the campaign's currency is.
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
  kpis: { views: 1000, engagements: 43, engagementRate: 0.043, emv: 61.5 },
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

  // 40 likes + 2 comments over 1000 views is 4.20%, not 420%.
  expect(posts).toContain(',4.2\n');
  expect(posts).not.toContain('420');
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

it('leaves an unmeasured counter empty instead of writing 0', async () => {
  mockDb.post.findMany.mockResolvedValue([
    measuredPost({ likesCount: 0, commentsCount: 0, sharesCount: 0, savesCount: 0, lastSyncedAt: null }),
  ]);

  const row = section(await (await call()).text(), 'Posts').trim().split('\n')[1];
  // views, then four empty counters, then an empty rate.
  expect(row.endsWith('1000,,,,,')).toBe(true);
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
  expect(row).toContain(',4.3,');
  expect(row).not.toContain(',0.43,');
});

it('labels EMV as USD when the campaign is not', async () => {
  mockPerformance.mockResolvedValue(performance({ currency: 'INR' }));

  const csv = await (await call()).text();

  expect(csv).toContain('EMV (USD)');
  expect(section(csv, 'Summary')).toContain('EMV (USD),61.5');
});

it('keeps the plain EMV label for a USD campaign', async () => {
  const csv = await (await call()).text();
  expect(csv).not.toContain('EMV (USD)');
  expect(section(csv, 'Summary')).toContain('EMV,61.5');
});
