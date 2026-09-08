/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/clients/route';

jest.mock('@/lib/db', () => ({
  db: {
    client: {
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

// ─── GET /api/clients ─────────────────────────────────────────────────────────

describe('GET /api/clients', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/clients');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns list of clients', async () => {
    const mockClients = [
      { id: 'cl-1', name: 'Acme Corp', orgId: 'org-1' },
      { id: 'cl-2', name: 'Beta Inc', orgId: 'org-1' },
    ];
    mockDb.client.findMany.mockResolvedValue(mockClients);

    const req = new NextRequest('http://localhost/api/clients');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.clients).toEqual(mockClients);
    expect(body.clients).toHaveLength(2);
  });

  it('returns empty clients array when no clients', async () => {
    mockDb.client.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/clients');
    const res = await GET(req);
    const body = await res.json();

    expect(body.clients).toEqual([]);
  });

  it('queries only orgId clients', async () => {
    mockDb.client.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/clients');
    await GET(req);

    expect(mockDb.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: 'org-1' },
      })
    );
  });
});

// ─── POST /api/clients ────────────────────────────────────────────────────────

describe('POST /api/clients', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Client' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates client and returns 201', async () => {
    const created = { id: 'cl-new', name: 'New Client', orgId: 'org-1', logoUrl: null };
    mockDb.client.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Client' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe('New Client');
  });

  it('returns 400 when name is missing', async () => {
    const req = new NextRequest('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ logoUrl: 'https://example.com/logo.png' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  /* The route had no validation beyond `if (!name)`, so all of these were
     accepted and written: a name that renders as nothing, an unbounded paste,
     and a javascript: URL headed for an <img src>. */
  it('refuses a name that is only whitespace', async () => {
    const req = new NextRequest('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: '   ' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect((await POST(req)).status).toBe(400);
    expect(mockDb.client.create).not.toHaveBeenCalled();
  });

  it('refuses a name longer than 120 characters', async () => {
    const req = new NextRequest('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'x'.repeat(121) }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect((await POST(req)).status).toBe(400);
    expect(mockDb.client.create).not.toHaveBeenCalled();
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'not a url'])(
    'refuses %s as a logoUrl',
    async (logoUrl) => {
      const req = new NextRequest('http://localhost/api/clients', {
        method: 'POST',
        body: JSON.stringify({ name: 'Acme', logoUrl }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect((await POST(req)).status).toBe(400);
      expect(mockDb.client.create).not.toHaveBeenCalled();
    }
  );

  it('trims the stored name rather than keeping the padding', async () => {
    mockDb.client.create.mockResolvedValue({ id: 'cl-new', name: 'Acme', orgId: 'org-1' });
    const req = new NextRequest('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: '  Acme  ' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req);
    expect(mockDb.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Acme' }) })
    );
  });

  it('stores an object contactInfo as the JSON string the column holds', async () => {
    mockDb.client.create.mockResolvedValue({ id: 'cl-new', name: 'Acme', orgId: 'org-1' });
    const req = new NextRequest('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Acme', contactInfo: { email: 'a@b.com' } }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req);
    expect(mockDb.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contactInfo: '{"email":"a@b.com"}' }),
      })
    );
  });

  it('writes null, not undefined, when contactInfo is absent', async () => {
    mockDb.client.create.mockResolvedValue({ id: 'cl-new', name: 'Acme', orgId: 'org-1' });
    const req = new NextRequest('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Acme' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req);
    expect(mockDb.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactInfo: null }) })
    );
  });

  it('creates client with optional logoUrl', async () => {
    const created = { id: 'cl-new', name: 'Acme', orgId: 'org-1', logoUrl: 'https://example.com/logo.png' };
    mockDb.client.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Acme', logoUrl: 'https://example.com/logo.png' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.logoUrl).toBe('https://example.com/logo.png');
  });
});
