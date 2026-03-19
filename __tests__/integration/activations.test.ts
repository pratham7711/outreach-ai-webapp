/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/activations/route';

jest.mock('@/lib/db', () => ({
  db: {
    activation: {
      findMany: jest.fn(),
      create: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── GET /api/activations ─────────────────────────────────────────────────────

describe('GET /api/activations', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/activations');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns activations list', async () => {
    const mockActivations = [
      {
        id: 'act-1',
        campaignId: 'camp-1',
        creatorId: 'creator-1',
        creator: { id: 'creator-1', name: 'Alice', handle: '@alice', platform: 'TIKTOK', avatarUrl: null },
        campaign: { id: 'camp-1', title: 'Test Campaign' },
      },
    ];
    mockDb.activation.findMany.mockResolvedValue(mockActivations);

    const req = new NextRequest('http://localhost/api/activations');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activations).toEqual(mockActivations);
  });

  it('filters by campaignId when provided', async () => {
    mockDb.activation.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/activations?campaignId=camp-1');
    await GET(req);

    expect(mockDb.activation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: 'camp-1' }),
      })
    );
  });

  it('excludes soft-deleted activations', async () => {
    mockDb.activation.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/activations');
    await GET(req);

    expect(mockDb.activation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it('returns empty activations array when none found', async () => {
    mockDb.activation.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/activations');
    const res = await GET(req);
    const body = await res.json();

    expect(body.activations).toEqual([]);
  });
});

// ─── POST /api/activations ────────────────────────────────────────────────────

describe('POST /api/activations', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/activations', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'camp-1', creatorId: 'creator-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates activation and returns 201', async () => {
    const created = { id: 'act-new', campaignId: 'camp-1', creatorId: 'creator-1', status: 'ACTIVE' };
    mockDb.activation.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost/api/activations', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'camp-1', creatorId: 'creator-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.campaignId).toBe('camp-1');
    expect(body.creatorId).toBe('creator-1');
  });

  it('returns 400 when campaignId is missing', async () => {
    const req = new NextRequest('http://localhost/api/activations', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'creator-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when creatorId is missing', async () => {
    const req = new NextRequest('http://localhost/api/activations', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'camp-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('creates activation with optional deliverableDueDate', async () => {
    const created = {
      id: 'act-new',
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      deliverableDueDate: new Date('2025-12-31'),
    };
    mockDb.activation.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost/api/activations', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: 'camp-1',
        creatorId: 'creator-1',
        deliverableDueDate: '2025-12-31',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});
