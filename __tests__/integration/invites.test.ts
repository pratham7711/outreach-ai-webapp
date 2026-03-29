/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/invites/route';
import { DELETE } from '@/app/api/invites/[id]/route';
import { POST as ACCEPT } from '@/app/api/invites/accept/route';

// Mock db before any imports use it
jest.mock('@/lib/db', () => ({
  db: {
    userInvite: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
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

// ─── POST /api/invites ───────────────────────────────────────────────────────

describe('POST /api/invites', () => {
  const createdInvite = {
    id: 'inv-1',
    orgId: 'org-1',
    email: 'new@example.com',
    role: 'MEMBER',
    token: 'tok-1',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    createdAt: new Date(),
  };

  it('creates invite with default MEMBER role', async () => {
    mockDb.userInvite.findFirst.mockResolvedValue(null);
    mockDb.userInvite.create.mockResolvedValue(createdInvite);

    const req = makeRequest('http://localhost/api/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.email).toBe('new@example.com');
    expect(mockDb.userInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'MEMBER', orgId: 'org-1' }),
      })
    );
  });

  it('creates invite with specified role', async () => {
    mockDb.userInvite.findFirst.mockResolvedValue(null);
    mockDb.userInvite.create.mockResolvedValue({ ...createdInvite, role: 'ADMIN' });

    const req = makeRequest('http://localhost/api/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', role: 'ADMIN' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockDb.userInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'ADMIN' }),
      })
    );
  });

  it('rejects duplicate pending invite for same email', async () => {
    mockDb.userInvite.findFirst.mockResolvedValue(createdInvite);

    const req = makeRequest('http://localhost/api/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('pending invite');
  });

  it('rejects invalid email', async () => {
    const req = makeRequest('http://localhost/api/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid email');
  });

  it('returns 401 without session', async () => {
    mockAuth.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/invites ────────────────────────────────────────────────────────

describe('GET /api/invites', () => {
  it('lists invites for org', async () => {
    const invites = [
      {
        id: 'inv-1',
        orgId: 'org-1',
        email: 'a@example.com',
        role: 'MEMBER',
        token: 'tok-1',
        expiresAt: new Date(Date.now() + 86400000),
        acceptedAt: null,
        createdAt: new Date(),
      },
      {
        id: 'inv-2',
        orgId: 'org-1',
        email: 'b@example.com',
        role: 'ADMIN',
        token: 'tok-2',
        expiresAt: new Date(Date.now() - 86400000),
        acceptedAt: null,
        createdAt: new Date(),
      },
    ];
    mockDb.userInvite.findMany.mockResolvedValue(invites);

    const req = makeRequest('http://localhost/api/invites');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.invites).toHaveLength(2);
    expect(body.invites[0].status).toBe('pending');
    expect(body.invites[1].status).toBe('expired');
  });

  it('returns 401 without session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/invites/[id] ────────────────────────────────────────────────

describe('DELETE /api/invites/[id]', () => {
  it('cancels invite', async () => {
    mockDb.userInvite.findUnique.mockResolvedValue({ id: 'inv-1', orgId: 'org-1' });
    mockDb.userInvite.delete.mockResolvedValue({ id: 'inv-1' });

    const req = makeRequest('http://localhost/api/invites/inv-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('inv-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 404 for wrong org invite', async () => {
    mockDb.userInvite.findUnique.mockResolvedValue({ id: 'inv-1', orgId: 'org-other' });

    const req = makeRequest('http://localhost/api/invites/inv-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('inv-1'));

    expect(res.status).toBe(404);
  });

  it('returns 404 for nonexistent invite', async () => {
    mockDb.userInvite.findUnique.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/invites/inv-999', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('inv-999'));

    expect(res.status).toBe(404);
  });

  it('returns 401 without session', async () => {
    mockAuth.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/invites/inv-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('inv-1'));

    expect(res.status).toBe(401);
  });
});

// ─── POST /api/invites/accept ────────────────────────────────────────────────

describe('POST /api/invites/accept', () => {
  const validInvite = {
    id: 'inv-1',
    orgId: 'org-1',
    email: 'new@example.com',
    role: 'MEMBER',
    token: 'valid-token',
    expiresAt: new Date(Date.now() + 86400000),
    acceptedAt: null,
    createdAt: new Date(),
  };

  it('creates user and marks invite accepted', async () => {
    mockDb.userInvite.findUnique.mockResolvedValue(validInvite);
    mockDb.user.findUnique.mockResolvedValue(null);

    const newUser = { id: 'user-new', email: 'new@example.com', name: 'New User', role: 'MEMBER' };
    mockDb.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        user: { create: jest.fn().mockResolvedValue(newUser) },
        userInvite: { update: jest.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const req = makeRequest('http://localhost/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'valid-token', name: 'New User', password: 'secret123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await ACCEPT(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.email).toBe('new@example.com');
    expect(body.name).toBe('New User');
  });

  it('rejects expired invite', async () => {
    const expiredInvite = {
      ...validInvite,
      expiresAt: new Date(Date.now() - 86400000),
    };
    mockDb.userInvite.findUnique.mockResolvedValue(expiredInvite);

    const req = makeRequest('http://localhost/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'valid-token', name: 'User', password: 'secret123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await ACCEPT(req);

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain('expired');
  });

  it('rejects already-accepted invite', async () => {
    const acceptedInvite = {
      ...validInvite,
      acceptedAt: new Date(),
    };
    mockDb.userInvite.findUnique.mockResolvedValue(acceptedInvite);

    const req = makeRequest('http://localhost/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'valid-token', name: 'User', password: 'secret123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await ACCEPT(req);

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain('already been accepted');
  });

  it('rejects invalid token', async () => {
    mockDb.userInvite.findUnique.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'bad-token', name: 'User', password: 'secret123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await ACCEPT(req);

    expect(res.status).toBe(404);
  });

  it('rejects missing fields', async () => {
    const req = makeRequest('http://localhost/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'valid-token' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await ACCEPT(req);

    expect(res.status).toBe(400);
  });
});
