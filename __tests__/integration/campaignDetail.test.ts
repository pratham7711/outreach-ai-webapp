/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '@/app/api/campaigns/[id]/route';

// Mock db before any imports use it
jest.mock('@/lib/db', () => {
  /* PATCH find-or-creates the Song and TikTokSound behind an audioUrl inside
     db.$transaction. The mock runs the callback against itself, which is what
     a real interactive transaction hands the callback. */
  const db: any = {
    campaign: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    campaignStatusDef: { findMany: jest.fn(), findFirst: jest.fn() },
    tikTokSound: { findFirst: jest.fn(), create: jest.fn() },
    song: { findFirst: jest.fn(), create: jest.fn() },
  };
  db.$transaction = jest.fn((fn: any) => fn(db));
  return { db };
});

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

const mockAuth = auth as jest.Mock;
const mockDb = (db as any);

const authedSession = { user: { id: 'user-1', orgId: 'org-1', role: 'OWNER' } };

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const mockCampaign = {
  id: 'camp-1', orgId: 'org-1', title: 'Test Campaign', status: 'IN_PROGRESS',
  campaignType: 'BUDGET_BASED', budget: 25000, currency: 'USD', notes: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  deletedAt: null,
  teamMembers: [],
  tags: [],
  activations: [{
    id: 'act-1', status: 'APPROVED', deliverableDueDate: null,
    creator: { id: 'c1', name: 'Test Creator', handle: '@test', platform: 'TIKTOK', followersCount: 100000, avatarUrl: null, rate: 2000 },
  }],
  posts: [{
    id: 'p1', platform: 'TIKTOK', platformPostId: 'tt-1', postUrl: 'https://tiktok.com/test',
    caption: 'Test post', postedAt: new Date().toISOString(),
    viewsCount: 50000, likesCount: 3000, commentsCount: 200, sharesCount: 100, engagementRate: 6.4,
    creator: { id: 'c1', name: 'Test Creator' },
  }],
  brief: null,
  financials: { spentAmount: 5000, totalBudget: 25000 },
  _count: { activations: 1, posts: 1 },
};

// The org's own statuses, shaped as both prod orgs actually have them.
const STATUS_DEFS = [
  { id: 'def-pending', name: 'Pending', bucket: 'PENDING', sortOrder: 0 },
  { id: 'def-active', name: 'In-Progress', bucket: 'IN_PROGRESS', sortOrder: 1 },
  { id: 'def-invoice', name: 'Need To Invoice', bucket: 'IN_PROGRESS', sortOrder: 2 },
  { id: 'def-complete', name: 'Complete', bucket: 'COMPLETE', sortOrder: 5 },
  { id: 'def-paused', name: 'Paused', bucket: 'CANCELLED', sortOrder: 6 },
  { id: 'def-canceled', name: 'Canceled', bucket: 'CANCELLED', sortOrder: 7 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.campaignStatusDef.findMany.mockResolvedValue(STATUS_DEFS);
  // findForeignRef proves a statusDefId in the body belongs to this org.
  mockDb.campaignStatusDef.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(STATUS_DEFS.find((d) => d.id === where.id) ?? null)
  );
});

// ─── GET /api/campaigns/[id] — detail data ──────────────────────────────────

describe('GET /api/campaigns/[id] detail', () => {
  it('returns activations with creator data', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);

    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    const res = await GET(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activations).toHaveLength(1);
    expect(body.activations[0].creator.name).toBe('Test Creator');
  });

  it('returns posts with creator relation', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);

    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    const res = await GET(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].creator.id).toBe('c1');
    expect(body.posts[0].creator.name).toBe('Test Creator');
  });

  it('returns financials data', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);

    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    const res = await GET(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.financials.spentAmount).toBe(5000);
    expect(body.financials.totalBudget).toBe(25000);
  });

  it('filters by orgId', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);

    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    await GET(req, makeParams('camp-1'));

    expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: 'org-1', deletedAt: null }),
      })
    );
  });
});

// ─── PATCH /api/campaigns/[id] — ownership check ────────────────────────────

describe('PATCH /api/campaigns/[id] ownership', () => {
  it('returns 404 for campaign not in org', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/campaigns/[id] — ownership check ────────────────────────────

describe('DELETE /api/campaigns/[id] ownership', () => {
  it('returns 404 for campaign not in org', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/campaigns/camp-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('camp-1'));
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/campaigns/[id] — additional coverage ──────────────────────────

describe('GET /api/campaigns/[id] auth and errors', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    const res = await GET(req, makeParams('camp-1'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 for non-existent campaign', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/nonexistent');
    const res = await GET(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('returns 500 on database error', async () => {
    mockDb.campaign.findFirst.mockRejectedValue(new Error('DB error'));
    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    const res = await GET(req, makeParams('camp-1'));
    expect(res.status).toBe(500);
  });

  it('filters soft-deleted campaigns (includes deletedAt: null in where)', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    await GET(req, makeParams('camp-1'));
    expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'camp-1', orgId: 'org-1', deletedAt: null }),
      })
    );
  });
});

// ─── PATCH /api/campaigns/[id] — full coverage ──────────────────────────────

describe('PATCH /api/campaigns/[id] full coverage', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('updates campaign title successfully', async () => {
    // Already carries its bucket's named status, so this patch touches only
    // the title -- see 'PATCH /api/campaigns/[id] named status' below.
    const existing = { id: 'camp-1', orgId: 'org-1', title: 'Old Title', deletedAt: null,
      status: 'IN_PROGRESS', statusDefId: 'def-active' };
    const updated = { ...existing, title: 'New Title', tags: [], teamMembers: [], _count: { activations: 0, posts: 0 } };
    mockDb.campaign.findFirst.mockResolvedValue(existing);
    mockDb.campaign.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'New Title' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('New Title');
    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'camp-1' }, data: { title: 'New Title' } })
    );
  });

  it('returns 400 for invalid status enum', async () => {
    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'INVALID_STATUS' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid input');
    expect(body.details).toBeDefined();
  });

  it('returns 400 for negative budget', async () => {
    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ budget: -100 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid input');
  });

  it('returns 500 on database error', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', orgId: 'org-1', deletedAt: null });
    mockDb.campaign.update.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Valid Title' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(500);
  });
});

// ─── PATCH /api/campaigns/[id] — RBAC edit_own ownership ──────────────────────

/* A campaign never sits without a named status. "No status" was an option in
   the dropdown and the state every campaign was created in; both are gone, so
   PATCH has to keep the invariant true for rows arriving from anywhere. */
describe('PATCH /api/campaigns/[id] named status', () => {
  const patch = async (body: Record<string, unknown>) => {
    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return PATCH(req, makeParams('camp-1'));
  };

  it("fills in the bucket's own status when the row arrived carrying none", async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ ...mockCampaign, statusDefId: null });
    mockDb.campaign.update.mockResolvedValue(mockCampaign);

    expect((await patch({ title: 'Renamed' })).status).toBe(200);

    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statusDefId: 'def-active' }) })
    );
  });

  it('moves the named status with the bucket', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ ...mockCampaign, statusDefId: 'def-active' });
    mockDb.campaign.update.mockResolvedValue(mockCampaign);

    await patch({ status: 'COMPLETE' });

    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETE', statusDefId: 'def-complete' }),
      })
    );
  });

  // Paused sorts first under CANCELLED, and a cancelled campaign is not paused.
  it('resolves CANCELLED to Canceled rather than the first def in the bucket', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ ...mockCampaign, statusDefId: 'def-active' });
    mockDb.campaign.update.mockResolvedValue(mockCampaign);

    await patch({ status: 'CANCELLED' });

    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statusDefId: 'def-canceled' }) })
    );
  });

  it('leaves a status the caller named alone', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ ...mockCampaign, statusDefId: 'def-active' });
    mockDb.campaign.update.mockResolvedValue(mockCampaign);

    await patch({ status: 'IN_PROGRESS', statusDefId: 'def-invoice' });

    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statusDefId: 'def-invoice' }) })
    );
  });

  // The old dropdown sent exactly this to mean "No status".
  it("turns an explicit null back into the bucket's own status", async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ ...mockCampaign, statusDefId: 'def-invoice' });
    mockDb.campaign.update.mockResolvedValue(mockCampaign);

    await patch({ statusDefId: null });

    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statusDefId: 'def-active' }) })
    );
  });

  it('does not re-read the org statuses when the named status is unchanged', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ ...mockCampaign, statusDefId: 'def-active' });
    mockDb.campaign.update.mockResolvedValue(mockCampaign);

    await patch({ title: 'Renamed' });

    expect(mockDb.campaignStatusDef.findMany).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/campaigns/[id] RBAC edit_own', () => {
  it('MEMBER can edit a campaign they created', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'member-1', orgId: 'org-1', role: 'MEMBER' } });
    const existing = { id: 'camp-1', orgId: 'org-1', title: 'Mine', createdById: 'member-1', deletedAt: null };
    mockDb.campaign.findFirst.mockResolvedValue(existing);
    mockDb.campaign.update.mockResolvedValue({ ...existing, title: 'Mine Edited', tags: [], teamMembers: [], _count: { activations: 0, posts: 0 } });

    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Mine Edited' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(200);
  });

  it('MEMBER cannot edit a campaign created by someone else (403, no write)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'member-1', orgId: 'org-1', role: 'MEMBER' } });
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', orgId: 'org-1', title: 'Theirs', createdById: 'other-user', deletedAt: null });

    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Hijack' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(403);
    expect(mockDb.campaign.update).not.toHaveBeenCalled();
  });

  it('VIEWER cannot edit any campaign (403 at the RBAC gate)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'viewer-1', orgId: 'org-1', role: 'VIEWER' } });
    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'x' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/campaigns/[id] — full coverage ──────────────────────────────

describe('DELETE /api/campaigns/[id] full coverage', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('soft deletes campaign (sets deletedAt)', async () => {
    const existing = { id: 'camp-1', orgId: 'org-1', deletedAt: null };
    mockDb.campaign.findFirst.mockResolvedValue(existing);
    mockDb.campaign.update.mockResolvedValue({ ...existing, deletedAt: new Date() });

    const req = makeRequest('http://localhost/api/campaigns/camp-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'camp-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
  });

  it('returns 500 on database error', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', orgId: 'org-1', deletedAt: null });
    mockDb.campaign.update.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost/api/campaigns/camp-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('camp-1'));
    expect(res.status).toBe(500);
  });
});

/*
 * Audio on a campaign that already exists.
 *
 * The wizard asks for a sound link once, at creation, and there was no second
 * chance: a campaign whose sound was decided later carried none, so its
 * Performance tab and every client report shared off it showed no audio at all.
 * The link resolves through the same ensureSongForAudio the create route uses,
 * so a second campaign on the same sound joins that tracker instead of forking
 * a private copy of it.
 */
describe('PATCH /api/campaigns/[id] audio link', () => {
  const existing = {
    id: 'camp-1', orgId: 'org-1', title: 'Jamie MacDonald - Roots', deletedAt: null,
    status: 'COMPLETE', statusDefId: 'def-complete', songId: null,
  };

  function patchAudio(audioUrl: string) {
    mockDb.campaign.findFirst.mockResolvedValue(existing);
    mockDb.campaign.update.mockResolvedValue({
      ...existing, songId: 'song-1', tagLinks: [], teamMembers: [], _count: { activations: 0, posts: 0 },
    });
    return PATCH(
      makeRequest('http://localhost/api/campaigns/camp-1', {
        method: 'PATCH',
        body: JSON.stringify({ audioUrl }),
        headers: { 'Content-Type': 'application/json' },
      }),
      makeParams('camp-1')
    );
  }

  it('attaches a newly created song to the campaign', async () => {
    mockDb.tikTokSound.findFirst.mockResolvedValue(null);
    mockDb.tikTokSound.create.mockResolvedValue({ id: 'sound-1' });
    mockDb.song.findFirst.mockResolvedValue(null);
    mockDb.song.create.mockResolvedValue({ id: 'song-1' });

    const res = await patchAudio('https://www.tiktok.com/music/Roots-7678797827745155089?lang=en');

    expect(res.status).toBe(200);
    // The id comes off the URL, not off the slug in front of it.
    expect(mockDb.tikTokSound.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tiktokSoundId: '7678797827745155089', platform: 'TIKTOK' }),
      })
    );
    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ songId: 'song-1' }) })
    );
  });

  it('joins the sound this org already tracks rather than forking a second tracker', async () => {
    mockDb.tikTokSound.findFirst.mockResolvedValue({ id: 'sound-1' });
    mockDb.song.findFirst.mockResolvedValue({ id: 'song-1' });

    const res = await patchAudio('https://www.tiktok.com/music/Roots-7678797827745155089');

    expect(res.status).toBe(200);
    expect(mockDb.tikTokSound.create).not.toHaveBeenCalled();
    expect(mockDb.song.create).not.toHaveBeenCalled();
    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ songId: 'song-1' }) })
    );
  });

  it('rejects a post link with a 400 and writes nothing at all', async () => {
    const res = await patchAudio('https://www.tiktok.com/@someone/video/7123456789012345678');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: 'video_url' }));
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.campaign.update).not.toHaveBeenCalled();
  });

  /* audioUrl is not a Campaign column. Left in the rest-spread it reaches
     Prisma as an unknown field, which fails the update -- so the campaign the
     operator was attaching audio to would not be written at all. */
  it('never writes audioUrl onto the campaign row', async () => {
    mockDb.tikTokSound.findFirst.mockResolvedValue({ id: 'sound-1' });
    mockDb.song.findFirst.mockResolvedValue({ id: 'song-1' });

    await patchAudio('https://www.tiktok.com/music/Roots-7678797827745155089');

    const { data } = mockDb.campaign.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('audioUrl');
  });
});
