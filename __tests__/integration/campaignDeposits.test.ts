/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/[id]/deposits/route';
import { POST as RELEASE } from '@/app/api/campaigns/[id]/deposits/release/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    campaignDeposit: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  },
}));
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/audit', () => ({ logAudit: jest.fn(), createAuditActor: jest.fn().mockReturnValue({ userId: 'u1', actorEmail: 'a@b.c', actorType: 'user' }) }));
jest.mock('@/lib/request', () => ({ getRequestIp: jest.fn().mockReturnValue('127.0.0.1') }));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const session = { user: { id: 'user-1', orgId: 'org-1', role: 'OWNER' } };
const mockCampaign = { id: 'camp-1', orgId: 'org-1', deletedAt: null };

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) { return new NextRequest(url, options); }
function makeParams(id: string) { return { params: Promise.resolve({ id }) }; }

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
});

describe('GET /api/campaigns/[id]/deposits', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/deposits'), makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('returns deposit', async () => {
    const deposit = { id: 'd1', amountUsd: 5000, status: 'PENDING' };
    mockDb.campaignDeposit.findFirst.mockResolvedValue(deposit);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/deposits'), makeParams('camp-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.deposit).toEqual(deposit);
  });
});

describe('POST /api/campaigns/[id]/deposits', () => {
  it('creates deposit', async () => {
    mockDb.campaignDeposit.findFirst.mockResolvedValue(null);
    const created = { id: 'd-new', amountRequested: 5000, status: 'PENDING', gateway: 'STRIPE' };
    mockDb.campaignDeposit.create.mockResolvedValue(created);

    const res = await POST(makeRequest('http://localhost/api/campaigns/camp-1/deposits', {
      method: 'POST',
      body: JSON.stringify({ amountRequested: 5000, gateway: 'STRIPE' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(201);
  });

  it('returns 409 when deposit already exists', async () => {
    mockDb.campaignDeposit.findFirst.mockResolvedValue({ id: 'd-existing' });

    const res = await POST(makeRequest('http://localhost/api/campaigns/camp-1/deposits', {
      method: 'POST',
      body: JSON.stringify({ amountRequested: 5000, gateway: 'STRIPE' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(409);
  });
});

describe('POST /api/campaigns/[id]/deposits/release', () => {
  it('releases funds', async () => {
    mockDb.campaignDeposit.findFirst.mockResolvedValue({ id: 'd1', amountUsd: 5000, releasedAmount: 0, status: 'HELD' });
    mockDb.campaignDeposit.updateMany.mockResolvedValue({ count: 1 });
    mockDb.campaignDeposit.findUniqueOrThrow.mockResolvedValue({ id: 'd1', releasedAmount: 1000, status: 'PARTIALLY_RELEASED' });

    const res = await RELEASE(makeRequest('http://localhost/api/campaigns/camp-1/deposits/release', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.releasedAmount).toBe(1000);
  });

  /* 500.31 released in thirds: 166.77 + 166.77 + 166.77 is 500.31000000000006
     as a float, so the last instalment of a legitimate release was rejected and
     the deposit could never reach FULLY_RELEASED. The comparison is in cents. */
  it('accepts the final instalment of a deposit split into thirds', async () => {
    mockDb.campaignDeposit.findFirst.mockResolvedValue({
      id: 'd1', amountUsd: 500.31, releasedAmount: 333.54, status: 'PARTIALLY_RELEASED',
    });
    mockDb.campaignDeposit.updateMany.mockResolvedValue({ count: 1 });
    mockDb.campaignDeposit.findUniqueOrThrow.mockResolvedValue({ id: 'd1', releasedAmount: 500.31, status: 'FULLY_RELEASED' });

    const res = await RELEASE(makeRequest('http://localhost/api/campaigns/camp-1/deposits/release', {
      method: 'POST',
      body: JSON.stringify({ amount: 166.77 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));

    expect(res.status).toBe(200);
    expect(mockDb.campaignDeposit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { releasedAmount: 500.31, status: 'FULLY_RELEASED' } })
    );
  });

  /* Two releases that both read "500 left" used to both pass the check and both
     write. The write is now conditional on the row this request read. */
  it('409s a release that lost the race to another release', async () => {
    mockDb.campaignDeposit.findFirst.mockResolvedValue({ id: 'd1', amountUsd: 5000, releasedAmount: 0, status: 'HELD' });
    mockDb.campaignDeposit.updateMany.mockResolvedValue({ count: 0 });

    const res = await RELEASE(makeRequest('http://localhost/api/campaigns/camp-1/deposits/release', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));

    expect(res.status).toBe(409);
    expect(mockDb.campaignDeposit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'd1', orgId: 'org-1', status: 'HELD', releasedAmount: 0 } })
    );
    expect(mockDb.campaignDeposit.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('refuses a VIEWER', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', orgId: 'org-1', role: 'VIEWER' } });
    const res = await RELEASE(makeRequest('http://localhost/api/campaigns/camp-1/deposits/release', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(403);
    expect(mockDb.campaignDeposit.updateMany).not.toHaveBeenCalled();
  });

  it('still refuses a release a cent over the deposit', async () => {
    mockDb.campaignDeposit.findFirst.mockResolvedValue({
      id: 'd1', amountUsd: 500.31, releasedAmount: 333.54, status: 'PARTIALLY_RELEASED',
    });

    const res = await RELEASE(makeRequest('http://localhost/api/campaigns/camp-1/deposits/release', {
      method: 'POST',
      body: JSON.stringify({ amount: 166.78 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));

    expect(res.status).toBe(400);
  });

  it('returns 400 when release exceeds remaining', async () => {
    mockDb.campaignDeposit.findFirst.mockResolvedValue({ id: 'd1', amountUsd: 5000, releasedAmount: 4500, status: 'PARTIALLY_RELEASED' });

    const res = await RELEASE(makeRequest('http://localhost/api/campaigns/camp-1/deposits/release', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(400);
  });
});
