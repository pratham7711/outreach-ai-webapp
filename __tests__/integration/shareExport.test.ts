/**
 * @jest-environment node
 *
 * The share export is reachable with no session at all -- the token is the whole
 * authorisation -- so the rules it has to keep are the page's rules, not softer
 * ones: a revoked link exports nothing, a link that hides creators exports no
 * creator names, and a counter nobody measured comes out empty rather than as a
 * zero a brand would read as a measurement.
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

it('leaves an unmeasured counter empty instead of writing 0', async () => {
  mockDb.post.findMany.mockResolvedValue([
    post({ savesCount: 0, downloadsCount: 0, lastSyncedAt: null }),
  ]);

  const body = await (await call()).text();
  const [, row] = body.trim().split('\r\n');
  const cells = row.split(',');

  // Views are carried by every source; saves and downloads are not, and this
  // post was never synced, so those two cells are blank.
  expect(cells).toContain('22600');
  expect(cells.slice(-3, -1)).toEqual(['', '']);
});

it('leaves saves and downloads blank even on a synced post', async () => {
  // A sync stamps lastSyncedAt while fetching neither counter, so the timestamp
  // is no evidence for those two columns -- only a value is.
  mockDb.post.findMany.mockResolvedValue([
    post({ savesCount: 0, downloadsCount: 0, lastSyncedAt: new Date('2026-08-22T00:00:00Z') }),
  ]);

  const body = await (await call()).text();
  const row = body.trim().split('\r\n')[1].split(',');

  expect(row.slice(-3, -1)).toEqual(['', '']);
});

it('exports saves and downloads that the CreatorCore import did write', async () => {
  mockDb.post.findMany.mockResolvedValue([
    post({ savesCount: 155, downloadsCount: 10, lastSyncedAt: null }),
  ]);

  const body = await (await call()).text();
  const row = body.trim().split('\r\n')[1].split(',');

  expect(row.slice(-3, -1)).toEqual(['155', '10']);
});

it('exports a measured zero for a counter something does fetch', async () => {
  mockDb.post.findMany.mockResolvedValue([
    post({ likesCount: 0, commentsCount: 0, lastSyncedAt: new Date('2026-08-22T00:00:00Z') }),
  ]);

  const body = await (await call()).text();
  const row = body.trim().split('\r\n')[1].split(',');

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
  // Platform, Posted, Views, Likes, Comments, Shares, Saves, Downloads, Last synced.
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
  ]);
  // Cells stay aligned with the header rather than leaving a hole.
  expect(row.split(',')).toHaveLength(9);
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
