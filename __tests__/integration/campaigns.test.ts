/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/route';

// Mock db before any imports use it
jest.mock('@/lib/db', () => {
  /* POST now writes the campaign inside db.$transaction, so the Song and
     TikTokSound rows an audio link creates cannot outlive a failed insert.
     The mock runs the callback against itself, which is what a real
     interactive transaction hands the callback. */
  const db: any = {
    campaign: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    tikTokSound: { findFirst: jest.fn(), create: jest.fn() },
    song: { findFirst: jest.fn(), create: jest.fn() },
    campaignStatusDef: { findMany: jest.fn() },
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

// The org's own statuses, as both prod orgs actually have them: CANCELLED
// holds Paused before Canceled, which is why the default is picked by name
// and not by sortOrder alone.
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
});

// ─── GET /api/campaigns ───────────────────────────────────────────────────────

describe('GET /api/campaigns', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns');
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns campaigns list with pagination', async () => {
    const mockCampaigns = [
      { id: '1', title: 'Campaign A', status: 'DRAFT', tags: [], teamMembers: [], _count: { activations: 0, posts: 0 } },
    ];
    mockDb.campaign.findMany.mockResolvedValue(mockCampaigns);
    mockDb.campaign.count.mockResolvedValue(1);

    const req = makeRequest('http://localhost/api/campaigns');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaigns).toEqual(mockCampaigns);
    expect(body.pagination.total).toBe(1);
    expect(body.pagination.page).toBe(1);
  });

  // Search matches the campaign title or its client's name, the same as the
  // list page, so a search for a brand finds that brand's campaigns.
  it('passes search param to db query', async () => {
    mockDb.campaign.findMany.mockResolvedValue([]);
    mockDb.campaign.count.mockResolvedValue(0);

    const req = makeRequest('http://localhost/api/campaigns?search=test');
    await GET(req);

    expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { title: expect.objectContaining({ contains: 'test' }) },
            { client: { name: expect.objectContaining({ contains: 'test' }) } },
          ],
        }),
      })
    );
  });

  it('passes status filter to db query', async () => {
    mockDb.campaign.findMany.mockResolvedValue([]);
    mockDb.campaign.count.mockResolvedValue(0);

    const req = makeRequest('http://localhost/api/campaigns?status=DRAFT');
    await GET(req);

    expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['DRAFT'] } }),
      })
    );
  });

  it('returns 500 on database error', async () => {
    mockDb.campaign.findMany.mockRejectedValue(new Error('DB connection failed'));

    const req = makeRequest('http://localhost/api/campaigns');
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ─── POST /api/campaigns ──────────────────────────────────────────────────────

describe('POST /api/campaigns', () => {
  const newCampaign = {
    id: 'camp-new',
    title: 'New Campaign',
    status: 'DRAFT',
    orgId: 'org-1',
    tags: [],
    teamMembers: [],
    _count: { activations: 0, posts: 0 },
  };

  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates campaign and returns 201', async () => {
    mockDb.campaign.create.mockResolvedValue(newCampaign);

    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ title: 'New Campaign' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.title).toBe('New Campaign');
  });

  /* A campaign is created and started in one action -- there is no launch
     step -- so it opens Active with the org's own name for that bucket. It
     used to be written as DRAFT with no named status, which is a state with no
     tab on the campaigns page and the literal label "No status" on the row. */
  describe('the status a new campaign opens in', () => {
    it('opens IN_PROGRESS, not DRAFT', async () => {
      mockDb.campaign.create.mockResolvedValue(newCampaign);

      const req = makeRequest('http://localhost/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Campaign' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect((await POST(req)).status).toBe(201);

      expect(mockDb.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'IN_PROGRESS' }) })
      );
    });

    it("carries the org's named status for that bucket, so the row is never \"No status\"", async () => {
      mockDb.campaign.create.mockResolvedValue(newCampaign);

      const req = makeRequest('http://localhost/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Campaign' }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(req);

      expect(mockDb.campaignStatusDef.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1' } })
      );
      expect(mockDb.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ statusDefId: 'def-active' }) })
      );
    });

    it('honours an explicit status and names it too', async () => {
      mockDb.campaign.create.mockResolvedValue({ ...newCampaign, status: 'COMPLETE' });

      const req = makeRequest('http://localhost/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Campaign', status: 'COMPLETE' }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(req);

      expect(mockDb.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETE', statusDefId: 'def-complete' }),
        })
      );
    });

    // An org that has defined none is the one case a campaign legitimately
    // carries no named status; it must still be created rather than 500.
    it('writes a null statusDefId when the org has defined no statuses', async () => {
      mockDb.campaignStatusDef.findMany.mockResolvedValue([]);
      mockDb.campaign.create.mockResolvedValue(newCampaign);

      const req = makeRequest('http://localhost/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Campaign' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect((await POST(req)).status).toBe(201);

      expect(mockDb.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_PROGRESS', statusDefId: null }),
        })
      );
    });
  });

  /* The Song and TikTokSound rows an audio link creates exist only to be
     pointed at by the campaign. They used to be written first, on the global
     client, so a campaign insert that then failed left both behind with nothing
     referencing them -- and a TikTokSound is a standing instruction to fetch a
     page on a schedule, so the orphan keeps costing something. */
  describe('audio link', () => {
    const withAudio = {
      title: 'Sound Campaign',
      audioUrl: 'https://www.tiktok.com/music/Test-7123456789012345678',
    };

    it('creates the sound and song inside the same transaction as the campaign', async () => {
      mockDb.tikTokSound.findFirst.mockResolvedValue(null);
      mockDb.tikTokSound.create.mockResolvedValue({ id: 'sound-1' });
      mockDb.song.findFirst.mockResolvedValue(null);
      mockDb.song.create.mockResolvedValue({ id: 'song-1' });
      mockDb.campaign.create.mockResolvedValue({ ...newCampaign, songId: 'song-1' });

      const req = makeRequest('http://localhost/api/campaigns', {
        method: 'POST',
        body: JSON.stringify(withAudio),
        headers: { 'Content-Type': 'application/json' },
      });
      expect((await POST(req)).status).toBe(201);

      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
      expect(mockDb.tikTokSound.create).toHaveBeenCalled();
      expect(mockDb.song.create).toHaveBeenCalled();
      expect(mockDb.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ songId: 'song-1' }) })
      );
    });

    it('rolls the sound and song back when the campaign insert fails', async () => {
      mockDb.tikTokSound.findFirst.mockResolvedValue(null);
      mockDb.tikTokSound.create.mockResolvedValue({ id: 'sound-1' });
      mockDb.song.findFirst.mockResolvedValue(null);
      mockDb.song.create.mockResolvedValue({ id: 'song-1' });
      mockDb.campaign.create.mockRejectedValue(new Error('insert failed'));

      const req = makeRequest('http://localhost/api/campaigns', {
        method: 'POST',
        body: JSON.stringify(withAudio),
        headers: { 'Content-Type': 'application/json' },
      });
      expect((await POST(req)).status).toBe(500);

      // The proof that they are inside it: the throw came out of $transaction,
      // which is what makes the two inserts above disappear with it.
      await expect(mockDb.$transaction.mock.results[0].value).rejects.toThrow('insert failed');
    });

    it('rejects a post link with a 400 before opening a transaction at all', async () => {
      const req = makeRequest('http://localhost/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Sound Campaign',
          audioUrl: 'https://www.tiktok.com/@someone/video/7123456789012345678',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect((await POST(req)).status).toBe(400);
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(mockDb.tikTokSound.create).not.toHaveBeenCalled();
    });
  });

  it('returns 400 for invalid input (empty title)', async () => {
    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ title: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when title missing', async () => {
    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 500 on database error', async () => {
    mockDb.campaign.create.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test Campaign' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('creates campaign with paymentMode field', async () => {
    const campaign = {
      id: 'camp-pm',
      title: 'Managed Campaign',
      status: 'DRAFT',
      paymentMode: 'MANAGED',
      tags: [],
      teamMembers: [],
      _count: { activations: 0, posts: 0 },
    };
    mockDb.campaign.create.mockResolvedValue(campaign);

    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Managed Campaign',
        paymentMode: 'MANAGED',
        paymentRelease: 'ON_POST_APPROVAL',
        postApprovalMode: 'AUTO_APPROVED',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockDb.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentMode: 'MANAGED',
          paymentRelease: 'ON_POST_APPROVAL',
          postApprovalMode: 'AUTO_APPROVED',
        }),
      })
    );
  });
});

/*
 * /api/campaigns/[id] is NOT tested here. Its GET, PATCH and DELETE live in
 * campaignDetail.test.ts, which covers the same cases plus RBAC (edit_own),
 * soft-delete filtering and the orgId where-clause. This file had a duplicate
 * of that block; the two drifted apart in strictness rather than in behaviour,
 * so the weaker copy is gone.
 */
