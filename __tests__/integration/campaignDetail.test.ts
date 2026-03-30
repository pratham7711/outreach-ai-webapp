/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '@/app/api/campaigns/[id]/route';

// Mock db before any imports use it
jest.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

const mockAuth = auth as jest.Mock;
const mockDb = (db as any);

const authedSession = { user: { id: 'user-1', orgId: 'org-1' } };

function makeRequest(url: string, options?: RequestInit) {
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

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
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
    const existing = { id: 'camp-1', orgId: 'org-1', title: 'Old Title', deletedAt: null };
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
