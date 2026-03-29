/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/creators/route';
import { GET as GETById, PATCH } from '@/app/api/creators/[id]/route';

jest.mock('@/lib/db', () => ({
  db: {
    creator: {
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

// ─── GET /api/creators ────────────────────────────────────────────────────────

describe('GET /api/creators', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/creators');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns creators list with pagination', async () => {
    const mockCreators = [
      { id: '1', name: 'Alice', handle: '@alice', platform: 'TIKTOK' },
    ];
    mockDb.creator.findMany.mockResolvedValue(mockCreators);
    mockDb.creator.count.mockResolvedValue(1);

    const req = makeRequest('http://localhost/api/creators');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.creators).toEqual(mockCreators);
    expect(body.pagination.total).toBe(1);
  });

  it('passes search param to query', async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    mockDb.creator.count.mockResolvedValue(0);

    const req = makeRequest('http://localhost/api/creators?search=alice');
    await GET(req);

    expect(mockDb.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: expect.objectContaining({ contains: 'alice' }) }),
          ]),
        }),
      })
    );
  });

  it('passes platform filter to query', async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    mockDb.creator.count.mockResolvedValue(0);

    const req = makeRequest('http://localhost/api/creators?platform=INSTAGRAM');
    await GET(req);

    expect(mockDb.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ platform: 'INSTAGRAM' }),
      })
    );
  });

  it('returns 500 on database error', async () => {
    mockDb.creator.findMany.mockRejectedValue(new Error('DB error'));
    const req = makeRequest('http://localhost/api/creators');
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/creators ───────────────────────────────────────────────────────

describe('POST /api/creators', () => {
  const validBody = { name: 'Bob Creator', handle: '@bobcreator', platform: 'TIKTOK' };

  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/creators', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates creator and returns 201', async () => {
    const created = { id: 'creator-1', ...validBody, orgId: 'org-1' };
    mockDb.creator.create.mockResolvedValue(created);

    const req = makeRequest('http://localhost/api/creators', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe('Bob Creator');
  });

  it('defaults platform to TIKTOK when not provided', async () => {
    const created = { id: 'creator-1', name: 'Bob', handle: '@bob', platform: 'TIKTOK' };
    mockDb.creator.create.mockResolvedValue(created);

    const req = makeRequest('http://localhost/api/creators', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bob', handle: '@bob' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockDb.creator.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ platform: 'TIKTOK' }),
      })
    );
  });

  it('returns 400 for missing name', async () => {
    const req = makeRequest('http://localhost/api/creators', {
      method: 'POST',
      body: JSON.stringify({ handle: '@bob' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing handle', async () => {
    const req = makeRequest('http://localhost/api/creators', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bob' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email', async () => {
    const req = makeRequest('http://localhost/api/creators', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bob', handle: '@bob', contactEmail: 'not-an-email' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 500 on database error', async () => {
    mockDb.creator.create.mockRejectedValue(new Error('DB error'));
    const req = makeRequest('http://localhost/api/creators', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/creators/[id] ───────────────────────────────────────────────────

describe('GET /api/creators/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/creators/creator-1');
    const res = await GETById(req, makeParams('creator-1'));
    expect(res.status).toBe(401);
  });

  it('returns creator by id', async () => {
    const creator = { id: 'creator-1', name: 'Alice', deletedAt: null, _count: { activations: 2, posts: 10 } };
    mockDb.creator.findFirst.mockResolvedValue(creator);

    const req = makeRequest('http://localhost/api/creators/creator-1');
    const res = await GETById(req, makeParams('creator-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('creator-1');
  });

  it('returns 404 when creator not found', async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/creators/nonexistent');
    const res = await GETById(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('returns 404 for soft-deleted creator', async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/creators/creator-1');
    const res = await GETById(req, makeParams('creator-1'));
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/creators/[id] ─────────────────────────────────────────────────

describe('PATCH /api/creators/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/creators/creator-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('creator-1'));
    expect(res.status).toBe(401);
  });

  it('updates creator successfully', async () => {
    const updated = { id: 'creator-1', name: 'Updated Name', handle: '@alice' };
    mockDb.creator.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/creators/creator-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('creator-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Updated Name');
  });

  it('returns 500 on database error', async () => {
    mockDb.creator.update.mockRejectedValue(new Error('DB error'));

    const req = makeRequest('http://localhost/api/creators/creator-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('creator-1'));
    expect(res.status).toBe(500);
  });
});
