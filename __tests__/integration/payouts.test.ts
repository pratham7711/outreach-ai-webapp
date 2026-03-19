/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/payouts/route';

jest.mock('@/lib/db', () => ({
  db: {
    payout: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    payoutBalance: {
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

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.payoutBalance.findFirst.mockResolvedValue(null);
});

// ─── GET /api/payouts ─────────────────────────────────────────────────────────

describe('GET /api/payouts', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/payouts');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns payouts with pagination', async () => {
    const mockPayouts = [
      { id: 'p1', amount: '500', status: 'PENDING', creator: { id: 'c1', name: 'Alice', handle: '@alice', platform: 'TIKTOK' }, campaign: null },
    ];
    mockDb.payout.findMany.mockResolvedValue(mockPayouts);
    mockDb.payout.count.mockResolvedValue(1);

    const req = new NextRequest('http://localhost/api/payouts');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.payouts).toEqual(mockPayouts);
    expect(body.pagination.total).toBe(1);
  });

  it('includes balance info in response', async () => {
    mockDb.payout.findMany.mockResolvedValue([]);
    mockDb.payout.count.mockResolvedValue(0);
    const balanceRecord = { orgId: 'org-1', balance: '10000', currency: 'USD' };
    mockDb.payoutBalance.findFirst.mockResolvedValue(balanceRecord);

    const req = new NextRequest('http://localhost/api/payouts');
    const res = await GET(req);
    const body = await res.json();

    expect(body.balance).toEqual(balanceRecord);
  });

  it('passes status filter to db query', async () => {
    mockDb.payout.findMany.mockResolvedValue([]);
    mockDb.payout.count.mockResolvedValue(0);

    const req = new NextRequest('http://localhost/api/payouts?status=SUCCESS');
    await GET(req);

    expect(mockDb.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'SUCCESS' }),
      })
    );
  });
});

// ─── POST /api/payouts ────────────────────────────────────────────────────────

describe('POST /api/payouts', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/payouts', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c1', amount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates payout and returns 201', async () => {
    const created = { id: 'p-new', creatorId: 'c1', amount: '500', currency: 'USD', status: 'PENDING' };
    mockDb.payout.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost/api/payouts', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c1', amount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.creatorId).toBe('c1');
  });

  it('returns 400 when creatorId is missing', async () => {
    const req = new NextRequest('http://localhost/api/payouts', {
      method: 'POST',
      body: JSON.stringify({ amount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is missing', async () => {
    const req = new NextRequest('http://localhost/api/payouts', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('defaults currency to USD', async () => {
    const created = { id: 'p-new', creatorId: 'c1', amount: '500', currency: 'USD', status: 'PENDING' };
    mockDb.payout.create.mockResolvedValue(created);

    const req = new NextRequest('http://localhost/api/payouts', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c1', amount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req);

    expect(mockDb.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currency: 'USD', paymentMethod: 'PAYPAL' }),
      })
    );
  });
});
