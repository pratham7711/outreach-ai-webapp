/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/creators/[id]/route';

jest.mock('@/lib/db', () => {
  const db: any = {
    creator: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    creatorDetail: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    $queryRawUnsafe: jest.fn(),
    // Campaign counts, and the campaign list behind them, are derived from
    // posts and activations rather than read off the relation.
    post: { groupBy: jest.fn().mockResolvedValue([]) },
    activation: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    campaign: { findMany: jest.fn().mockResolvedValue([]) },
    // The lists a creator is on, shown on their profile.
    creatorListItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  db.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db };
});

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { ROSTER_TABLES } from '@/lib/creators/rosterSchemaDdl';
import { resetRosterTablesCache } from '@/lib/creators/rosterTables';

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: 'user-1', orgId: 'org-1', role: 'OWNER' } };

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── GET /api/creators/[id] ──────────────────────────────────────────────────

describe('GET /api/creators/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/creators/cr-1');
    const res = await GET(req, makeParams('cr-1'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('lists campaigns reached through posts, not only through activations', async () => {
    mockDb.creator.findFirst.mockResolvedValue({
      id: 'cr-1', orgId: 'org-1', deletedAt: null, activations: [], posts: [], _count: {},
    });
    // 1,824 of 1,834 creators look exactly like this: posts on campaigns, no activation.
    mockDb.post.groupBy.mockResolvedValue([
      { campaignId: 'camp-a', _count: { _all: 33 } },
      { campaignId: 'camp-b', _count: { _all: 4 } },
    ]);
    mockDb.activation.findMany.mockResolvedValue([]);
    mockDb.campaign.findMany.mockResolvedValue([
      { id: 'camp-b', title: 'Beta', status: 'COMPLETE', budget: null, currency: 'USD' },
      { id: 'camp-a', title: 'Alpha', status: 'IN_PROGRESS', budget: 1000, currency: 'USD' },
    ]);

    const body = await (await GET(makeRequest('http://localhost/api/creators/cr-1'), makeParams('cr-1'))).json();

    // Most of the creator's work first, and every row carries its own count.
    expect(body.campaigns.map((c: any) => [c.id, c.postCount])).toEqual([
      ['camp-a', 33],
      ['camp-b', 4],
    ]);
    expect(body.campaigns.every((c: any) => c.activation === null)).toBe(true);
  });

  it('returns no campaigns rather than an empty query when there are none', async () => {
    mockDb.creator.findFirst.mockResolvedValue({
      id: 'cr-1', orgId: 'org-1', deletedAt: null, activations: [], posts: [], _count: {},
    });
    mockDb.post.groupBy.mockResolvedValue([]);
    mockDb.activation.findMany.mockResolvedValue([]);
    mockDb.campaign.findMany.mockClear();

    const body = await (await GET(makeRequest('http://localhost/api/creators/cr-1'), makeParams('cr-1'))).json();

    expect(body.campaigns).toEqual([]);
    expect(mockDb.campaign.findMany).not.toHaveBeenCalled();
  });

  it('keeps the activation when there is one, so its status and due date survive', async () => {
    mockDb.creator.findFirst.mockResolvedValue({
      id: 'cr-1', orgId: 'org-1', deletedAt: null, activations: [], posts: [], _count: {},
    });
    mockDb.post.groupBy.mockResolvedValue([]);
    mockDb.activation.findMany.mockResolvedValue([
      { id: 'act-1', status: 'AWAITING_DRAFT', deliverableDueDate: null, campaignId: 'camp-a' },
    ]);
    mockDb.campaign.findMany.mockResolvedValue([
      { id: 'camp-a', title: 'Alpha', status: 'IN_PROGRESS', budget: null, currency: 'USD' },
    ]);

    const body = await (await GET(makeRequest('http://localhost/api/creators/cr-1'), makeParams('cr-1'))).json();

    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].activation.status).toBe('AWAITING_DRAFT');
    expect(body.campaigns[0].postCount).toBe(0);
  });

  /* Plan A6: the page is told when its follower figure was measured, decided
     from the read that wrote it -- here the newest tracker reading, whose count
     matches. A count no read produced would get no time at all. */
  it('dates the follower figure by the reading that produced it', async () => {
    mockDb.creator.findFirst.mockResolvedValue({
      id: 'cr-1', orgId: 'org-1', name: 'A', handle: '@fake.a', platform: 'TIKTOK', followersCount: 1500, activations: [], posts: [],
    });
    const recordedAt = new Date('2026-10-01T06:00:00Z');
    mockDb.creatorTrackerSnapshot = {
      groupBy: jest.fn().mockResolvedValue([{ creatorId: 'cr-1', _max: { recordedAt } }]),
      findMany: jest.fn().mockResolvedValue([{ creatorId: 'cr-1', followersCount: 1500, avgViews: 0, recordedAt }]),
    };
    try {
      const body = await (await GET(makeRequest('http://localhost/api/creators/cr-1'), makeParams('cr-1'))).json();
      expect(body.figureTimes.followers).toMatchObject({ at: recordedAt.toISOString(), source: 'Tracker reading', field: 'tracker' });
      expect(mockDb.creatorTrackerSnapshot.groupBy.mock.calls[0][0].where).toEqual({ creatorId: { in: ['cr-1'] }, creator: { orgId: 'org-1' } });
    } finally {
      delete mockDb.creatorTrackerSnapshot;
    }
  });

  it('names the lists the creator is on, scoped to the org', async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: 'cr-1', orgId: 'org-1', name: 'A', handle: '@a', platform: 'TIKTOK', activations: [], posts: [] });
    mockDb.creatorListItem.findMany.mockResolvedValueOnce([{ list: { id: 'list-1', name: 'Anime Pages' } }]);

    const res = await GET(makeRequest('http://localhost/api/creators/cr-1'), makeParams('cr-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.lists).toEqual([{ id: 'list-1', name: 'Anime Pages' }]);
    expect(mockDb.creatorListItem.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { creatorId: 'cr-1', list: { orgId: 'org-1' } } }),
    );
  });

  it('returns creator with correct shape', async () => {
    const creator = {
      id: 'cr-1',
      name: 'Test Creator',
      handle: '@test',
      platform: 'TIKTOK',
      orgId: 'org-1',
      deletedAt: null,
      activations: [],
      posts: [],
      payouts: [],
      _count: { activations: 0, posts: 0, payouts: 0 },
    };
    mockDb.creator.findFirst.mockResolvedValue(creator);

    const req = makeRequest('http://localhost/api/creators/cr-1');
    const res = await GET(req, makeParams('cr-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('cr-1');
    expect(body.name).toBe('Test Creator');
    expect(body).toHaveProperty('activations');
    expect(body).toHaveProperty('posts');
    expect(body).toHaveProperty('payouts');
    expect(body).toHaveProperty('_count');
    expect(body).toHaveProperty('campaigns');
  });

  it('returns 404 for non-existent creator', async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/creators/nonexistent');
    const res = await GET(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('returns 500 on database error', async () => {
    mockDb.creator.findFirst.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost/api/creators/cr-1');
    const res = await GET(req, makeParams('cr-1'));
    expect(res.status).toBe(500);
  });

  it('filters by orgId from session (multi-tenancy)', async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/creators/cr-1');
    await GET(req, makeParams('cr-1'));
    expect(mockDb.creator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cr-1', orgId: 'org-1', deletedAt: null }),
      })
    );
  });

  it('returns 404 for soft-deleted creator', async () => {
    mockDb.creator.findFirst.mockResolvedValue(null); // deletedAt filter means it won't be found
    const req = makeRequest('http://localhost/api/creators/cr-1');
    const res = await GET(req, makeParams('cr-1'));
    expect(res.status).toBe(404);
    expect(mockDb.creator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });
});

// ─── PATCH /api/creators/[id] ────────────────────────────────────────────────

describe('PATCH /api/creators/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cr-1'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('updates creator fields', async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: 'cr-1', orgId: 'org-1' });
    const updated = { id: 'cr-1', name: 'Updated Name', handle: '@updated', platform: 'INSTAGRAM' };
    mockDb.creator.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name', handle: '@updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cr-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Updated Name');
    expect(mockDb.creator.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cr-1' },
        data: { name: 'Updated Name', handle: '@updated' },
      })
    );
  });

  it('saves country, audience country and niche onto the detail row', async () => {
    resetRosterTablesCache();
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: ROSTER_TABLES.length }]);
    mockDb.creator.findFirst.mockResolvedValue({ id: 'cr-1', orgId: 'org-1' });
    mockDb.creator.update.mockResolvedValue({ id: 'cr-1', name: 'A' });

    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ audienceCountry: ' Indonesia, Thailand ', niche: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cr-1'));

    expect(res.status).toBe(200);
    expect(mockDb.creator.update).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
    expect(mockDb.creatorDetail.upsert).toHaveBeenCalledWith({
      where: { creatorId: 'cr-1' },
      create: { creatorId: 'cr-1', orgId: 'org-1', audienceCountry: 'Indonesia, Thailand', niche: null },
      update: { audienceCountry: 'Indonesia, Thailand', niche: null },
    });
  });

  it('leaves the detail row alone when no detail field is sent', async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: 'cr-1', orgId: 'org-1' });
    mockDb.creator.update.mockResolvedValue({ id: 'cr-1', name: 'B' });
    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'B' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await PATCH(req, makeParams('cr-1'));
    expect(mockDb.creatorDetail.upsert).not.toHaveBeenCalled();
  });

  it('sets the follower and average-view counts of a record no refresh reads', async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: 'cr-1', orgId: 'org-1', followersCount: 1100000, averageViews: 0 });
    mockDb.creator.update.mockResolvedValue({ id: 'cr-1', name: 'B', followersCount: 276169, averageViews: 3200 });
    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ followersCount: 276169, averageViews: 3200 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect((await PATCH(req, makeParams('cr-1'))).status).toBe(200);
    expect(mockDb.creator.update).toHaveBeenCalledWith({ where: { id: 'cr-1' }, data: { followersCount: 276169, averageViews: 3200 } });
  });

  it('refuses a count that cannot be one', async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: 'cr-1', orgId: 'org-1' });
    for (const followersCount of [-1, '17.3k', null]) {
      const req = makeRequest('http://localhost/api/creators/cr-1', {
        method: 'PATCH',
        body: JSON.stringify({ followersCount }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect((await PATCH(req, makeParams('cr-1'))).status).toBe(400);
    }
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it('returns 500 on database error', async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: 'cr-1', orgId: 'org-1' });
    mockDb.creator.update.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Fail' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cr-1'));
    expect(res.status).toBe(500);
  });

  it('returns 404 when creator not found or wrong org', async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cr-1'));
    expect(res.status).toBe(404);
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid fields', async () => {
    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ contactEmail: 'not-an-email' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cr-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid input');
    expect(body).toHaveProperty('details');
  });

  it('returns 400 for invalid platform', async () => {
    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ platform: 'SNAPCHAT' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cr-1'));
    expect(res.status).toBe(400);
  });

  it('verifies orgId before updating (multi-tenancy)', async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: 'cr-1', orgId: 'org-1' });
    mockDb.creator.update.mockResolvedValue({ id: 'cr-1', name: 'Updated' });
    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await PATCH(req, makeParams('cr-1'));
    expect(mockDb.creator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cr-1', orgId: 'org-1', deletedAt: null }),
      })
    );
  });

  it('allows setting nullable fields to null', async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: 'cr-1', orgId: 'org-1' });
    mockDb.creator.update.mockResolvedValue({ id: 'cr-1', rate: null, bio: null });
    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ rate: null, bio: null }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cr-1'));
    expect(res.status).toBe(200);
    expect(mockDb.creator.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { rate: null, bio: null },
      })
    );
  });
});
