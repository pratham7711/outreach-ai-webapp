/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/lists/route';
import { GET as GETById } from '@/app/api/lists/[id]/route';

jest.mock('@/lib/db', () => ({
  db: {
    creatorList: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── GET /api/lists ───────────────────────────────────────────────────────────

describe('GET /api/lists', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/lists');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns list of creator lists', async () => {
    const mockLists = [
      { id: 'list-1', name: 'Top Creators', orgId: 'org-1', _count: { items: 5 } },
    ];
    mockDb.creatorList.findMany.mockResolvedValue(mockLists);

    const req = new NextRequest('http://localhost/api/lists');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.lists).toEqual(mockLists);
  });

  it('queries only orgId lists', async () => {
    mockDb.creatorList.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/lists');
    await GET(req);

    expect(mockDb.creatorList.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: 'org-1' },
      })
    );
  });

  it('returns empty lists array when no lists', async () => {
    mockDb.creatorList.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/lists');
    const res = await GET(req);
    const body = await res.json();

    expect(body.lists).toEqual([]);
  });
});

// ─── POST /api/lists ──────────────────────────────────────────────────────────

describe('POST /api/lists', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/lists', {
      method: 'POST',
      body: JSON.stringify({ name: 'My List' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates list and returns 201', async () => {
    const created = { id: 'list-new', name: 'My List', orgId: 'org-1', description: null };
    mockDb.creatorList.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost/api/lists', {
      method: 'POST',
      body: JSON.stringify({ name: 'My List' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe('My List');
  });

  it('returns 400 when name is missing', async () => {
    const req = new NextRequest('http://localhost/api/lists', {
      method: 'POST',
      body: JSON.stringify({ description: 'Some description' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('creates list with optional description', async () => {
    const created = { id: 'list-new', name: 'My List', orgId: 'org-1', description: 'Fav creators' };
    mockDb.creatorList.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost/api/lists', {
      method: 'POST',
      body: JSON.stringify({ name: 'My List', description: 'Fav creators' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.description).toBe('Fav creators');
  });
});

// ─── GET /api/lists/[id] ──────────────────────────────────────────────────────

describe('GET /api/lists/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/lists/list-1');
    const res = await GETById(req, makeParams('list-1'));
    expect(res.status).toBe(401);
  });

  it('returns list by id with items', async () => {
    const list = {
      id: 'list-1',
      name: 'Top Creators',
      items: [{ id: 'item-1', creator: { id: 'c1', name: 'Alice' } }],
    };
    mockDb.creatorList.findFirst.mockResolvedValue(list);

    const req = new NextRequest('http://localhost/api/lists/list-1');
    const res = await GETById(req, makeParams('list-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('list-1');
    expect(body.items).toHaveLength(1);
  });

  it('returns 404 when list not found', async () => {
    mockDb.creatorList.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/lists/nonexistent');
    const res = await GETById(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
  });
});
