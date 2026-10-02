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
    creatorListDetail: { findMany: jest.fn() },
    creatorListItemDetail: { groupBy: jest.fn() },
    creatorListShare: { findMany: jest.fn() },
    post: { groupBy: jest.fn().mockResolvedValue([]) },
  },
}));

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));
// Absent by default, so every case above the approval block runs the plain index.
jest.mock('@/lib/lists/approvalTables', () => ({ listApprovalTablesReady: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/creators/rosterTables', () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { listApprovalTablesReady } from '@/lib/lists/approvalTables';

const mockAuth = auth as jest.Mock;
const mockDb = (db as any);

/* ADMIN: the POST below is gated on a create permission now, and a session
   with no role at all resolves to none. The role-gate cases themselves live in
   writeRouteRoles.test.ts. */
const authedSession = { user: { id: 'user-1', orgId: 'org-1', role: 'ADMIN' } };

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

// ─── GET /api/lists, once the approval tables exist ──────────────────────────

describe('GET /api/lists with the list-approval tables', () => {
  beforeEach(() => {
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(true);
    mockDb.creatorList.findMany.mockResolvedValue([
      { id: 'list-1', name: 'Spring pitch', orgId: 'org-1', _count: { items: 3 } },
      { id: 'list-2', name: 'Old pitch', orgId: 'org-1', _count: { items: 2 } },
      { id: 'list-3', name: 'Fresh', orgId: 'org-1', _count: { items: 1 } },
    ]);
    mockDb.creatorListDetail.findMany.mockResolvedValue([
      { listId: 'list-1', isFavorite: true, archivedAt: null },
      { listId: 'list-2', isFavorite: false, archivedAt: new Date('2026-09-20') },
    ]);
    mockDb.creatorListItemDetail.groupBy.mockResolvedValue([
      { listId: 'list-1', decision: 'APPROVED', _count: { _all: 2 } },
      { listId: 'list-1', decision: 'REJECTED', _count: { _all: 1 } },
      { listId: 'list-2', decision: 'APPROVED', _count: { _all: 1 } },
    ]);
    mockDb.creatorListShare.findMany.mockResolvedValue([{ listId: 'list-1' }, { listId: 'list-2' }]);
  });
  afterEach(() => (listApprovalTablesReady as jest.Mock).mockResolvedValue(false));

  it('adds status, decision counts, favourite and archived to each row, keeping the plain fields', async () => {
    const body = await (await GET(new NextRequest('http://localhost/api/lists'))).json();
    expect(body.lists[0]).toEqual({
      id: 'list-1',
      name: 'Spring pitch',
      orgId: 'org-1',
      _count: { items: 3 },
      status: 'APPROVED',
      counts: { total: 3, approved: 2, rejected: 1, pending: 0 },
      isFavorite: true,
      archived: false,
    });
    expect(body.lists[1]).toMatchObject({ status: 'ARCHIVED', archived: true, counts: { pending: 1 } });
    // Never shared and nothing decided: a draft, every creator pending.
    expect(body.lists[2]).toMatchObject({ status: 'DRAFT', isFavorite: false, counts: { total: 1, pending: 1 } });
  });

  it('reads every approval table scoped to the session org', async () => {
    await GET(new NextRequest('http://localhost/api/lists'));
    const ids = { in: ['list-1', 'list-2', 'list-3'] };
    expect(mockDb.creatorListDetail.findMany.mock.calls[0][0].where).toEqual({ orgId: 'org-1', listId: ids });
    expect(mockDb.creatorListItemDetail.groupBy.mock.calls[0][0].where).toMatchObject({ orgId: 'org-1', listId: ids });
    expect(mockDb.creatorListShare.findMany.mock.calls[0][0].where).toEqual({ orgId: 'org-1', listId: ids, revokedAt: null });
  });

  it('leaves the payload exactly as before while the tables are absent', async () => {
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(false);
    const body = await (await GET(new NextRequest('http://localhost/api/lists'))).json();
    expect(body.lists[0]).toEqual({ id: 'list-1', name: 'Spring pitch', orgId: 'org-1', _count: { items: 3 } });
    expect(mockDb.creatorListDetail.findMany).not.toHaveBeenCalled();
  });
});
