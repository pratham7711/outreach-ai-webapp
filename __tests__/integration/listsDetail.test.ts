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
    creatorListDetail: { findFirst: jest.fn(), upsert: jest.fn() },
    creatorListItemDetail: { findMany: jest.fn() },
    creatorListShare: { findMany: jest.fn() },
    post: { groupBy: jest.fn().mockResolvedValue([]) },
  },
}));

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));
// Absent by default, so every case above the approval block runs the plain list.
jest.mock('@/lib/lists/approvalTables', () => ({ listApprovalTablesReady: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/creators/rosterTables', () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { listApprovalTablesReady } from '@/lib/lists/approvalTables';

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: 'user-1', orgId: 'org-1', role: 'OWNER' } };

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

// ─── The rate card, once the approval tables exist ──────────────────────────

describe('/api/lists/[id] with the list-approval tables', () => {
  const creator = (id: string) => ({ id, name: `Fake ${id}`, handle: `@fake_${id}`, platform: 'TIKTOK', followersCount: 1000, averageViews: 0, avatarUrl: null });
  const detail = (itemId: string, over: Record<string, unknown>) => ({
    itemId, rate: null, notes: null, sortOrder: null, decision: 'PENDING', decisionNote: null, decidedAt: null, ...over,
  });

  beforeEach(() => {
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(true);
    mockAuth.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1', role: 'MEMBER' } });
    mockDb.creatorList.findFirst.mockResolvedValue({
      id: 'list-1',
      name: 'Spring pitch',
      orgId: 'org-1',
      // Newest first, as the plain list orders them.
      items: [
        { id: 'item-3', creator: creator('c-3') },
        { id: 'item-2', creator: creator('c-2') },
        { id: 'item-1', creator: creator('c-1') },
      ],
      _count: { items: 3 },
    });
    mockDb.creatorListItemDetail.findMany.mockResolvedValue([
      detail('item-1', { sortOrder: 0, rate: 900, decision: 'APPROVED', decidedAt: new Date('2026-09-30T10:00:00Z') }),
      detail('item-2', { sortOrder: 1, decision: 'REJECTED', decisionNote: 'Off-brand' }),
    ]);
    mockDb.creatorListDetail.findFirst.mockResolvedValue({ isFavorite: true, archivedAt: null, duplicatedFromId: null });
    mockDb.creatorListShare.findMany.mockResolvedValue([{ listId: 'list-1' }]);
  });
  afterEach(() => (listApprovalTablesReady as jest.Mock).mockResolvedValue(false));

  it("shows the agency each creator's rate and the client's verdict, in pitch order", async () => {
    const body = await (await GET(makeRequest('http://localhost/api/lists/list-1'), makeParams('list-1'))).json();
    // Dragged rows first by sortOrder; the unordered newcomer lands at the end.
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['item-1', 'item-2', 'item-3']);
    expect(body.items[0].detail).toEqual({
      rate: 900, notes: null, sortOrder: 0, decision: 'APPROVED', decisionNote: null, decidedAt: '2026-09-30T10:00:00.000Z',
    });
    expect(body.items[1].detail).toMatchObject({ decision: 'REJECTED', decisionNote: 'Off-brand' });
    expect(body.items[2].detail).toMatchObject({ decision: 'PENDING', rate: null });
    expect(body.approval).toEqual({
      status: 'SHARED',
      counts: { total: 3, approved: 1, rejected: 1, pending: 1 },
      isFavorite: true,
      archived: false,
      duplicatedFromId: null,
    });
    expect(mockDb.creatorListItemDetail.findMany.mock.calls[0][0].where).toEqual({ orgId: 'org-1', listId: 'list-1' });
  });

  it('marks an unmeasured creator with no engagement rate rather than zero', async () => {
    const body = await (await GET(makeRequest('http://localhost/api/lists/list-1'), makeParams('list-1'))).json();
    expect(body.items[0].creator.engagementRate).toBeNull();
  });

  it('stars and archives through the list detail row', async () => {
    mockDb.creatorList.findFirst.mockResolvedValue({ id: 'list-1', name: 'Spring pitch', description: null, orgId: 'org-1' });
    mockDb.creatorList.update.mockResolvedValue({ id: 'list-1', name: 'Spring pitch', description: null });
    const res = await PATCH(
      makeRequest('http://localhost/api/lists/list-1', { method: 'PATCH', body: JSON.stringify({ isFavorite: true, archived: true }) }),
      makeParams('list-1'),
    );
    expect(res.status).toBe(200);
    const arg = mockDb.creatorListDetail.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ listId: 'list-1' });
    expect(arg.create).toMatchObject({ listId: 'list-1', orgId: 'org-1', isFavorite: true, archivedAt: expect.any(Date) });
  });

  it('refuses a star from a viewer, and says so before the migration has run', async () => {
    mockDb.creatorList.findFirst.mockResolvedValue({ id: 'list-1', name: 'Spring pitch', description: null, orgId: 'org-1' });
    const star = () =>
      PATCH(makeRequest('http://localhost/api/lists/list-1', { method: 'PATCH', body: JSON.stringify({ isFavorite: true }) }), makeParams('list-1'));
    mockAuth.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1', role: 'VIEWER' } });
    expect((await star()).status).toBe(403);
    mockAuth.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1', role: 'MEMBER' } });
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(false);
    expect((await star()).status).toBe(503);
    expect(mockDb.creatorListDetail.upsert).not.toHaveBeenCalled();
  });
});
