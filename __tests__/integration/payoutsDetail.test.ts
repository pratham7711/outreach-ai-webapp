/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/payouts/[id]/route';

jest.mock('@/lib/db', () => ({
  db: {
    payout: {
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

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── PATCH /api/payouts/[id] ─────────────────────────────────────────────────

describe('PATCH /api/payouts/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/payouts/pay-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PROCESSING' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('pay-1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when payout not found', async () => {
    mockDb.payout.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/payouts/nonexistent', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PROCESSING' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('updates payout status with valid transition (PENDING -> PROCESSING)', async () => {
    const existing = { id: 'pay-1', status: 'PENDING', orgId: 'org-1' };
    const updated = { ...existing, status: 'PROCESSING' };
    mockDb.payout.findFirst.mockResolvedValue(existing);
    mockDb.payout.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/payouts/pay-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PROCESSING' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('pay-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('PROCESSING');
  });

  it('rejects invalid status transition (SUCCESS -> FAILED)', async () => {
    const existing = { id: 'pay-1', status: 'SUCCESS', orgId: 'org-1' };
    mockDb.payout.findFirst.mockResolvedValue(existing);

    const req = makeRequest('http://localhost/api/payouts/pay-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'FAILED' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('pay-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot transition');
  });

  it('rejects invalid status transition (SUCCESS -> PENDING)', async () => {
    const existing = { id: 'pay-1', status: 'SUCCESS', orgId: 'org-1' };
    mockDb.payout.findFirst.mockResolvedValue(existing);

    const req = makeRequest('http://localhost/api/payouts/pay-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PENDING' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('pay-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot transition');
  });

  it('allows retry transition (FAILED -> PENDING)', async () => {
    const existing = { id: 'pay-1', status: 'FAILED', orgId: 'org-1' };
    const updated = { ...existing, status: 'PENDING', completedAt: null, failureReason: null };
    mockDb.payout.findFirst.mockResolvedValue(existing);
    mockDb.payout.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/payouts/pay-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PENDING' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('pay-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('PENDING');
    expect(mockDb.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          completedAt: null,
          failureReason: null,
        }),
      })
    );
  });

  it('returns 400 when status is missing', async () => {
    const existing = { id: 'pay-1', status: 'PENDING', orgId: 'org-1' };
    mockDb.payout.findFirst.mockResolvedValue(existing);

    const req = makeRequest('http://localhost/api/payouts/pay-1', {
      method: 'PATCH',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('pay-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('sets completedAt when transitioning to SUCCESS', async () => {
    const existing = { id: 'pay-1', status: 'PROCESSING', orgId: 'org-1' };
    const updated = { ...existing, status: 'SUCCESS', completedAt: new Date() };
    mockDb.payout.findFirst.mockResolvedValue(existing);
    mockDb.payout.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/payouts/pay-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SUCCESS' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await PATCH(req, makeParams('pay-1'));

    expect(mockDb.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUCCESS',
          completedAt: expect.any(Date),
        }),
      })
    );
  });

  it('allows direct Mark Paid transition (PENDING -> SUCCESS)', async () => {
    const existing = { id: 'pay-1', status: 'PENDING', orgId: 'org-1' };
    const updated = { ...existing, status: 'SUCCESS', completedAt: new Date() };
    mockDb.payout.findFirst.mockResolvedValue(existing);
    mockDb.payout.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/payouts/pay-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SUCCESS' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('pay-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('SUCCESS');
  });

  it('returns 400 for invalid status value (Zod validation)', async () => {
    const existing = { id: 'pay-1', status: 'PENDING', orgId: 'org-1' };
    mockDb.payout.findFirst.mockResolvedValue(existing);

    const req = makeRequest('http://localhost/api/payouts/pay-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'INVALID_STATUS' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('pay-1'));
    expect(res.status).toBe(400);
  });
});
