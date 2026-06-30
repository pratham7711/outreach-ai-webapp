/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/clients/[id]/route';

jest.mock('@/lib/db', () => ({
  db: {
    client: {
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

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const mockClient = {
  id: 'cl-1',
  orgId: 'org-1',
  name: 'Acme Records',
  logoUrl: 'https://example.com/logo.png',
  contactInfo: '{"email":"contact@acme.com","phone":"+1234567890"}',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  plan: { id: 'plan-1', name: 'Pro', features: {} },
  campaigns: [
    {
      id: 'camp-1',
      title: 'Summer Campaign',
      status: 'IN_PROGRESS',
      budget: 50000,
      currency: 'USD',
      createdAt: new Date().toISOString(),
      _count: { activations: 3 },
    },
  ],
  _count: { campaigns: 1 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── GET /api/clients/[id] ─────────────────────────────────────────────────

describe('GET /api/clients/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/clients/cl-1');
    const res = await GET(req, makeParams('cl-1'));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns client with campaigns', async () => {
    mockDb.client.findFirst.mockResolvedValue(mockClient);

    const req = makeRequest('http://localhost/api/clients/cl-1');
    const res = await GET(req, makeParams('cl-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('cl-1');
    expect(body.name).toBe('Acme Records');
    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].title).toBe('Summer Campaign');
    expect(body._count.campaigns).toBe(1);
    expect(body.plan.name).toBe('Pro');
  });

  it('returns 404 for non-existent client', async () => {
    mockDb.client.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/clients/cl-999');
    const res = await GET(req, makeParams('cl-999'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('returns 404 for wrong org (multi-tenancy)', async () => {
    mockDb.client.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/clients/cl-1');
    const res = await GET(req, makeParams('cl-1'));

    expect(res.status).toBe(404);
    expect(mockDb.client.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cl-1', orgId: 'org-1' }),
      })
    );
  });

  it('returns 500 on database error', async () => {
    mockDb.client.findFirst.mockRejectedValue(new Error('DB connection failed'));

    const req = makeRequest('http://localhost/api/clients/cl-1');
    const res = await GET(req, makeParams('cl-1'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });
});

// ─── PATCH /api/clients/[id] ───────────────────────────────────────────────

describe('PATCH /api/clients/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/clients/cl-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cl-1'));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('updates client name successfully', async () => {
    const existing = { id: 'cl-1', orgId: 'org-1', name: 'Acme Records' };
    const updated = { ...existing, name: 'Acme Music' };

    mockDb.client.findFirst.mockResolvedValue(existing);
    mockDb.client.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/clients/cl-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Acme Music' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cl-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Acme Music');
    expect(mockDb.client.update).toHaveBeenCalledWith({
      where: { id: 'cl-1' },
      data: { name: 'Acme Music' },
    });
  });

  it('updates client logoUrl', async () => {
    const existing = { id: 'cl-1', orgId: 'org-1', name: 'Acme Records' };
    const updated = { ...existing, logoUrl: 'https://example.com/new-logo.png' };

    mockDb.client.findFirst.mockResolvedValue(existing);
    mockDb.client.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/clients/cl-1', {
      method: 'PATCH',
      body: JSON.stringify({ logoUrl: 'https://example.com/new-logo.png' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cl-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.logoUrl).toBe('https://example.com/new-logo.png');
    expect(mockDb.client.update).toHaveBeenCalledWith({
      where: { id: 'cl-1' },
      data: { logoUrl: 'https://example.com/new-logo.png' },
    });
  });

  it('returns 404 when client not found', async () => {
    mockDb.client.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/clients/cl-999', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cl-999'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
    expect(mockDb.client.update).not.toHaveBeenCalled();
  });

  it('returns 404 for wrong org (multi-tenancy)', async () => {
    mockDb.client.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/clients/cl-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cl-1'));

    expect(res.status).toBe(404);
    expect(mockDb.client.findFirst).toHaveBeenCalledWith({
      where: { id: 'cl-1', orgId: 'org-1' },
    });
  });

  it('returns 400 for invalid logoUrl', async () => {
    mockDb.client.findFirst.mockResolvedValue({ id: 'cl-1', orgId: 'org-1' });

    const req = makeRequest('http://localhost/api/clients/cl-1', {
      method: 'PATCH',
      body: JSON.stringify({ logoUrl: 'not-a-url' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cl-1'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid input');
    expect(body.details).toBeDefined();
  });

  it('returns 400 for empty name', async () => {
    mockDb.client.findFirst.mockResolvedValue({ id: 'cl-1', orgId: 'org-1' });

    const req = makeRequest('http://localhost/api/clients/cl-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cl-1'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid input');
    expect(body.details).toBeDefined();
  });

  it('returns 500 on database error', async () => {
    mockDb.client.findFirst.mockResolvedValue({ id: 'cl-1', orgId: 'org-1' });
    mockDb.client.update.mockRejectedValue(new Error('DB write failed'));

    const req = makeRequest('http://localhost/api/clients/cl-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cl-1'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });

  it('allows setting nullable fields to null', async () => {
    const existing = { id: 'cl-1', orgId: 'org-1', name: 'Acme Records' };
    const updated = { ...existing, logoUrl: null, contactInfo: null };

    mockDb.client.findFirst.mockResolvedValue(existing);
    mockDb.client.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/clients/cl-1', {
      method: 'PATCH',
      body: JSON.stringify({ logoUrl: null, contactInfo: null }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('cl-1'));

    expect(res.status).toBe(200);
    expect(mockDb.client.update).toHaveBeenCalledWith({
      where: { id: 'cl-1' },
      data: { logoUrl: null, contactInfo: null },
    });
  });
});
