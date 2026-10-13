/**
 * @jest-environment node
 *
 * The share export is reachable with no session at all -- the token is the whole
 * authorisation -- so the rules it has to keep are the page's rules, not softer
 * ones: a revoked link exports nothing, a link that hides creators exports no
 * creator names, and a counter nobody measured comes out as "—" rather than as
 * a zero a brand would read as a measurement.
 *
 * Every row ends with As of and Source (plan A2/A6), and -- on a link whose
 * owner flags removed posts -- a Post status, all after the existing columns.
 * The helpers below index from the end past those three.
 */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/share/[token]/export/route';

jest.mock('@/lib/db', () => ({
  db: {
    report: { findUnique: jest.fn() },
    post: { findMany: jest.fn() },
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(), rateLimitKey: jest.fn() }));

import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';

const mockDb = db as any;
const mockRateLimit = rateLimit as jest.Mock;

const call = (token = 'tok') =>
  GET(new NextRequest(`http://localhost/api/share/${token}/export`), {
    params: Promise.resolve({ token }),
  });

const post = (over: Record<string, unknown> = {}) => ({
  platform: 'TIKTOK',
  postUrl: 'https://www.tiktok.com/@a/video/1',
  postedAt: new Date('2026-08-01T00:00:00Z'),
  viewsCount: 22600,
  likesCount: 1200,
  commentsCount: 14,
  sharesCount: 30,
  savesCount: 0,
  downloadsCount: 0,
  lastSyncedAt: null,
  creator: { name: 'Awx Yken', handle: 'awxyken' },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  mockDb.report.findUnique.mockResolvedValue({
    isPublic: true,
    config: { kind: 'campaign-performance' },
    campaign: { id: 'camp-1', title: 'Wherever I go - Ellie Holcomb', currency: 'USD' },
  });
  mockDb.post.findMany.mockResolvedValue([post()]);
});

it('serves a CSV attachment named after the campaign', async () => {
  const res = await call();

  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/csv');
  expect(res.headers.get('Content-Disposition')).toContain('Wherever-I-go---Ellie-Holcomb-posts.csv');
  // An unlisted link's contents should not sit in a shared cache.
  expect(res.headers.get('Cache-Control')).toBe('no-store');
});

it('exports only the posts still in the campaign, never one that was removed from it', async () => {
  const table: Record<string, unknown>[] = [
    post({ postUrl: 'https://www.tiktok.com/@a/video/1', removedAt: null }),
    post({ postUrl: 'https://www.tiktok.com/@a/video/2', removedAt: new Date('2026-10-10') }),
  ];
  mockDb.post.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve(
      table.filter((p) => !('removedAt' in where) || (where.removedAt === null) === (p.removedAt === null)),
    ),
  );
  const body = await (await call()).text();
  expect(mockDb.post.findMany.mock.calls[0][0].where).toMatchObject({ campaignId: 'camp-1', removedAt: null });
  expect(body.trim().split('\r\n')).toHaveLength(2);
  expect(body).not.toContain('video/2');
});

/** The cells up to and including Last synced: everything before the appended As of / Source. */
const coreCells = (row: string) => row.split(',').slice(0, -2);

it('writes an unmeasured counter as — instead of 0', async () => {
  mockDb.post.findMany.mockResolvedValue([
    post({ savesCount: 0, downloadsCount: 0, lastSyncedAt: null }),
  ]);

  const body = await (await call()).text();
  const [, row] = body.trim().split('\r\n');
  const cells = coreCells(row);

  // Views are carried by every source; saves and downloads are not, and this
  // post was never synced, so those two cells are "—".
  expect(cells).toContain('22600');
  expect(cells.slice(-3, -1)).toEqual(['—', '—']);
});

it('leaves saves and downloads unknown even on a synced post', async () => {
  // A sync stamps lastSyncedAt while fetching neither counter, so the timestamp
  // is no evidence for those two columns -- only a value is.
  mockDb.post.findMany.mockResolvedValue([
    post({ savesCount: 0, downloadsCount: 0, lastSyncedAt: new Date('2026-08-22T00:00:00Z') }),
  ]);

  const body = await (await call()).text();
  const row = coreCells(body.trim().split('\r\n')[1]);

  expect(row.slice(-3, -1)).toEqual(['—', '—']);
});

it('exports saves and downloads that the CreatorCore import did write', async () => {
  mockDb.post.findMany.mockResolvedValue([
    post({ savesCount: 155, downloadsCount: 10, lastSyncedAt: null }),
  ]);

  const body = await (await call()).text();
  const row = coreCells(body.trim().split('\r\n')[1]);

  expect(row.slice(-3, -1)).toEqual(['155', '10']);
});

it('exports a measured zero for a counter something does fetch', async () => {
  mockDb.post.findMany.mockResolvedValue([
    post({ likesCount: 0, commentsCount: 0, lastSyncedAt: new Date('2026-08-22T00:00:00Z') }),
  ]);

  const body = await (await call()).text();
  const row = coreCells(body.trim().split('\r\n')[1]);

  // Likes and comments sit right after Views, and a sync really does read them.
  expect(row.slice(-6, -4)).toEqual(['0', '0']);
});

const hiddenCreatorsLink = () =>
  mockDb.report.findUnique.mockResolvedValue({
    isPublic: true,
    config: { kind: 'campaign-performance', visibility: { showCreators: false } },
    campaign: { id: 'camp-1', title: 'C', currency: 'USD' },
  });

it('omits creator columns when the link hides creators', async () => {
  hiddenCreatorsLink();

  const body = await (await call()).text();
  const header = body.trim().split('\r\n')[0];

  expect(header).not.toContain('Creator');
  expect(body).not.toContain('Awx Yken');
  expect(body).not.toContain('awxyken');
});

it('drops the Post URL column too, header and cells, when creators are hidden', async () => {
  // A post URL carries /@handle/ in its path, so it re-identifies every creator
  // the link was set to hide -- which is why redactForShare nulls postUrl for
  // exactly this case. The CSV has to make the same call or it becomes the way
  // around the switch.
  hiddenCreatorsLink();

  const body = await (await call()).text();
  const [header, row] = body.trim().split('\r\n');

  expect(header).not.toContain('Post URL');
  expect(body).not.toContain('tiktok.com');
  // Platform, Posted, Views, Likes, Comments, Shares, Saves, Downloads, Last
  // synced, As of, Source.
  expect(header.replace(/^\uFEFF/, '').split(',')).toEqual([
    'Platform',
    'Posted',
    'Views',
    'Likes',
    'Comments',
    'Shares',
    'Saves',
    'Downloads',
    'Last synced',
    'As of',
    'Source',
  ]);
  // Cells stay aligned with the header rather than leaving a hole.
  expect(row.split(',')).toHaveLength(11);
});

it('keeps the Post URL column on a link that shows creators', async () => {
  const body = await (await call()).text();
  const [header, row] = body.trim().split('\r\n');

  expect(header).toContain('Post URL');
  expect(row).toContain('https://www.tiktok.com/@a/video/1');
});

it('refuses a revoked link', async () => {
  mockDb.report.findUnique.mockResolvedValue({
    isPublic: false,
    config: { kind: 'campaign-performance' },
    campaign: { id: 'camp-1', title: 'C', currency: 'USD' },
  });

  const res = await call();

  expect(res.status).toBe(404);
  expect(mockDb.post.findMany).not.toHaveBeenCalled();
});

it('refuses a token belonging to some other kind of report', async () => {
  mockDb.report.findUnique.mockResolvedValue({
    isPublic: true,
    config: { kind: 'something-else' },
    campaign: { id: 'camp-1', title: 'C', currency: 'USD' },
  });

  expect((await call()).status).toBe(404);
  expect(mockDb.post.findMany).not.toHaveBeenCalled();
});

it('refuses an unknown token', async () => {
  mockDb.report.findUnique.mockResolvedValue(null);

  expect((await call()).status).toBe(404);
});

it('turns away a caller walking the token space', async () => {
  mockRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 30 });

  const res = await call();

  expect(res.status).toBe(429);
  expect(res.headers.get('Retry-After')).toBe('30');
  expect(mockDb.report.findUnique).not.toHaveBeenCalled();
});

it('restricts the export to the platforms the link allows', async () => {
  mockDb.report.findUnique.mockResolvedValue({
    isPublic: true,
    config: { kind: 'campaign-performance', visibility: { showCreators: true, platforms: ['TIKTOK'] } },
    campaign: { id: 'camp-1', title: 'C', currency: 'USD' },
  });

  await call();

  expect(mockDb.post.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ platform: { in: ['TIKTOK'] } }),
    }),
  );
});

it('quotes a value that would otherwise break the row', async () => {
  mockDb.post.findMany.mockResolvedValue([post({ creator: { name: 'Doe, Jane "JD"', handle: 'jd' } })]);

  const body = await (await call()).text();

  expect(body).toContain('"Doe, Jane ""JD"""');
});

/* Creator display names are user text and this file is opened in Excel more
   often than anywhere else, so a name beginning with "=" was a formula the
   brand's spreadsheet would run. */
it('neutralises a creator name a spreadsheet would run as a formula', async () => {
  mockDb.post.findMany.mockResolvedValue([
    post({ creator: { name: '=cmd|\'/c calc\'!A0', handle: 'awxyken' } }),
  ]);

  const body = await (await call()).text();

  expect(body).toContain("'=cmd");
  expect(body).not.toMatch(/(^|,|")=cmd/m);
});

describe('age, source and post status', () => {
  const linkWith = (visibility: Record<string, unknown>) =>
    mockDb.report.findUnique.mockResolvedValue({
      isPublic: true,
      config: { kind: 'campaign-performance', visibility: { showCreators: true, ...visibility } },
      campaign: { id: 'camp-1', title: 'C', currency: 'USD' },
    });

  it('ends every row with when it was read and by what', async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ lastSyncedAt: new Date('2026-08-22T00:00:00Z') }),
      post({ postUrl: 'https://www.tiktok.com/@a/video/2', lastFreshAt: new Date('2026-07-20T00:00:00Z') }),
      post({ postUrl: 'https://www.tiktok.com/@a/video/3' }),
    ]);

    const [header, ...rows] = (await (await call()).text()).trim().split('\r\n');

    expect(header.endsWith(',Last synced,As of,Source')).toBe(true);
    expect(rows[0].endsWith(',2026-08-22T00:00:00.000Z,2026-08-22T00:00:00.000Z,Platform read')).toBe(true);
    // An imported post is dated by the import, and says so; Last synced stays empty.
    expect(rows[1].endsWith(',,2026-07-20T00:00:00.000Z,CreatorCore import')).toBe(true);
    expect(rows[2].endsWith(',,—,Not read')).toBe(true);
  });

  it('adds a Post status column only on a link that flags removed posts', async () => {
    linkWith({ markRemovedPosts: true });
    mockDb.post.findMany.mockResolvedValue([
      post({ lastSyncedAt: new Date('2026-08-22T00:00:00Z') }),
      post({
        postUrl: 'https://www.tiktok.com/@a/video/2',
        lastSyncedAt: new Date('2026-08-20T00:00:00Z'),
        platformMetrics: { __lastFetch: { reason: 'post-hidden', at: '2026-08-23T00:00:00.000Z', via: 'cron' } },
      }),
      post({
        postUrl: 'https://www.tiktok.com/@a/video/3',
        lastSyncedAt: new Date('2026-08-20T00:00:00Z'),
        fetchState: 'UNAVAILABLE',
        platformMetrics: { __lastFetch: { reason: 'post-deleted', at: '2026-08-24T00:00:00.000Z', strikes: 2, via: 'cron' } },
      }),
      // A read that failed on our side: the page does not flag it, nor does the file.
      post({
        postUrl: 'https://www.tiktok.com/@a/video/4',
        lastSyncedAt: new Date('2026-08-20T00:00:00Z'),
        platformMetrics: { __lastFetch: { reason: 'reader-timeout', at: '2026-08-24T00:00:00.000Z', via: 'cron' } },
      }),
    ]);

    const [header, ...rows] = (await (await call()).text()).trim().split('\r\n');

    expect(header.endsWith(',As of,Source,Post status')).toBe(true);
    expect(rows.map((r) => r.split(',').at(-1))).toEqual(['Live', 'Hidden', 'Deleted', '—']);
    // The hidden post keeps the numbers it earned.
    expect(rows[1]).toContain(',22600,1200,14,30,');
  });

  it('leaves Post status out on a link that does not flag removed posts', async () => {
    linkWith({ markRemovedPosts: false });
    mockDb.post.findMany.mockResolvedValue([
      post({ fetchState: 'UNAVAILABLE', platformMetrics: { __lastFetch: { reason: 'post-deleted', at: '2026-08-24T00:00:00.000Z', strikes: 2 } } }),
    ]);

    const body = await (await call()).text();

    expect(body).not.toContain('Post status');
    expect(body).not.toContain('Deleted');
  });
});
