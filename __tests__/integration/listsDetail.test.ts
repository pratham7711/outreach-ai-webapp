/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '@/app/api/lists/[id]/route';

jest.mock('@/lib/db', () => ({
  db: {
    creatorList: {
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    creatorListItem: {
      deleteMany: jest.fn(),
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

// ─── GET /api/lists/[id] ────────────────────────────────────────────────────

describe('GET /api/lists/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/lists/list-1');
    const res = await GET(req, makeParams('list-1'));
    expect(res.status).toBe(401);
  });

  it('returns list with items', async () => {
    const list = {
      id: 'list-1',
      name: 'Top Creators',
      description: 'Best performers',
      orgId: 'org-1',
      items: [
        {
          id: 'item-1',
          creator: {
            id: 'cr-1',
            name: 'Test Creator',
            handle: '@test',
            platform: 'TIKTOK',
            followersCount: 50000,
            averageViews: 10000,
            avatarUrl: null,
          },
        },
      ],
      _count: { items: 1 },
    };
    mockDb.creatorList.findFirst.mockResolvedValue(list);

    const req = makeRequest('http://localhost/api/lists/list-1');
    const res = await GET(req, makeParams('list-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('list-1');
    expect(body.name).toBe('Top Creators');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].creator.name).toBe('Test Creator');
    expect(body._count.items).toBe(1);
  });

  it('returns 404 when list not found', async () => {
    mockDb.creatorList.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/lists/nonexistent');
    const res = await GET(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

// ─── PATCH /api/lists/[id] ──────────────────────────────────────────────────

describe('PATCH /api/lists/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/lists/list-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('list-1'));
    expect(res.status).toBe(401);
  });

  it('updates list name', async () => {
    const existing = { id: 'list-1', name: 'Old Name', orgId: 'org-1' };
    const updated = { ...existing, name: 'New Name' };
    mockDb.creatorList.findFirst.mockResolvedValue(existing);
    mockDb.creatorList.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/lists/list-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('list-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('New Name');
  });

  it('updates list description', async () => {
    const existing = { id: 'list-1', name: 'My List', description: 'Old desc', orgId: 'org-1' };
    const updated = { ...existing, description: 'New description' };
    mockDb.creatorList.findFirst.mockResolvedValue(existing);
    mockDb.creatorList.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/lists/list-1', {
      method: 'PATCH',
      body: JSON.stringify({ description: 'New description' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('list-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.description).toBe('New description');
  });

  it('returns 404 when list not found', async () => {
    mockDb.creatorList.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/lists/nonexistent', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/lists/[id] ─────────────────────────────────────────────────

describe('DELETE /api/lists/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/lists/list-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('list-1'));
    expect(res.status).toBe(401);
  });

  it('deletes list and its items', async () => {
    const existing = { id: 'list-1', name: 'My List', orgId: 'org-1' };
    mockDb.creatorList.findFirst.mockResolvedValue(existing);
    mockDb.creatorListItem.deleteMany.mockResolvedValue({ count: 2 });
    mockDb.creatorList.delete.mockResolvedValue(existing);

    const req = makeRequest('http://localhost/api/lists/list-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('list-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDb.creatorListItem.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { listId: 'list-1' } })
    );
    expect(mockDb.creatorList.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'list-1' } })
    );
  });

  it('returns 404 when list not found', async () => {
    mockDb.creatorList.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/lists/nonexistent', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
  });
});
