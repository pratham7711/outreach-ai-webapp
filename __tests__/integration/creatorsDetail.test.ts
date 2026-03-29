/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/creators/[id]/route';

jest.mock('@/lib/db', () => ({
  db: {
    creator: {
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
const mockDb = db as any;

const authedSession = { user: { id: 'user-1', orgId: 'org-1' } };

function makeRequest(url: string, options?: RequestInit) {
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

  it('returns 500 on database error', async () => {
    mockDb.creator.update.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost/api/creators/cr-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Fail' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cr-1'));
    expect(res.status).toBe(500);
  });
});
