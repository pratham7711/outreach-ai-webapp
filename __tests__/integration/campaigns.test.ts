/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/route';
import { GET as GETById, PATCH, DELETE } from '@/app/api/campaigns/[id]/route';

// Mock db before any imports use it
jest.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
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

  it('passes search param to db query', async () => {
    mockDb.campaign.findMany.mockResolvedValue([]);
    mockDb.campaign.count.mockResolvedValue(0);

    const req = makeRequest('http://localhost/api/campaigns?search=test');
    await GET(req);

    expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          title: expect.objectContaining({ contains: 'test' }),
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
        where: expect.objectContaining({ status: 'DRAFT' }),
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

// ─── GET /api/campaigns/[id] ──────────────────────────────────────────────────

describe('GET /api/campaigns/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    const res = await GETById(req, makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('returns campaign by id', async () => {
    const campaign = { id: 'camp-1', orgId: 'org-1', title: 'Test', deletedAt: null, _count: { activations: 0, posts: 0 } };
    mockDb.campaign.findFirst.mockResolvedValue(campaign);

    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    const res = await GETById(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('camp-1');
    expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'camp-1', orgId: 'org-1', deletedAt: null }),
      })
    );
  });

  it('returns 404 when campaign not found', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/campaigns/nonexistent');
    const res = await GETById(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('returns 500 on database error', async () => {
    mockDb.campaign.findFirst.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    const res = await GETById(req, makeParams('camp-1'));
    expect(res.status).toBe(500);
  });
});

// ─── PATCH /api/campaigns/[id] ────────────────────────────────────────────────

describe('PATCH /api/campaigns/[id]', () => {
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

  it('updates campaign successfully', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', orgId: 'org-1' });
    const updated = { id: 'camp-1', title: 'Updated Title', status: 'IN_PROGRESS', tags: [], teamMembers: [], _count: { activations: 0, posts: 0 } };
    mockDb.campaign.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated Title' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('Updated Title');
  });

  it('returns 404 for campaign not in org', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated Title' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status value', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', orgId: 'org-1' });
    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'INVALID_STATUS' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/campaigns/[id] ───────────────────────────────────────────────

describe('DELETE /api/campaigns/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('soft deletes campaign and returns success', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', orgId: 'org-1' });
    mockDb.campaign.update.mockResolvedValue({ id: 'camp-1', deletedAt: new Date() });

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

  it('returns 404 for campaign not in org', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/campaigns/camp-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('camp-1'));
    expect(res.status).toBe(404);
  });

  it('returns 500 on database error', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', orgId: 'org-1' });
    mockDb.campaign.update.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost/api/campaigns/camp-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('camp-1'));
    expect(res.status).toBe(500);
  });
});
