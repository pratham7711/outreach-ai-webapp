/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/portal/payout-requests/route';

jest.mock('@/lib/db', () => ({
  db: {
    payoutRequest: { findMany: jest.fn(), create: jest.fn() },
    campaignProposal: { findFirst: jest.fn() },
    campaign: { findUnique: jest.fn() },
    creator: { findFirst: jest.fn() },
  },
}));

jest.mock('@/lib/creator-auth', () => ({
  getCreatorSession: jest.fn(),
}));

import { db } from '@/lib/db';
import { getCreatorSession } from '@/lib/creator-auth';

const mockSession = getCreatorSession as jest.Mock;
const mockDb = db as any;

const session = { id: 'sess-1', creatorUserId: 'cu-1', email: 'test@x.com', name: 'Test', handle: 'test' };

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(url, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue(session);
});

describe('GET /api/portal/payout-requests', () => {
  it('returns 401 when no session', async () => {
    mockSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns payout requests for creator user', async () => {
    const requests = [
      { id: 'pr-1', requestedAmount: 500, status: 'PENDING', campaign: { title: 'Camp 1' } },
    ];
    mockDb.payoutRequest.findMany.mockResolvedValue(requests);

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.requests).toEqual(requests);
    expect(mockDb.payoutRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { creatorUserId: 'cu-1' },
      }),
    );
  });
});

describe('POST /api/portal/payout-requests', () => {
  it('returns 401 when no session', async () => {
    mockSession.mockResolvedValue(null);
    const res = await POST(makeRequest('http://localhost/api/portal/payout-requests', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'c-1', requestedAmount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(401);
  });

  it('creates payout request when accepted proposal exists', async () => {
    mockDb.campaignProposal.findFirst.mockResolvedValue({ id: 'prop-1', status: 'ACCEPTED' });
    mockDb.campaign.findUnique.mockResolvedValue({ orgId: 'org-1' });
    mockDb.creator.findFirst.mockResolvedValue({ id: 'creator-1' });
    const created = {
      id: 'pr-1',
      requestedAmount: 500,
      currency: 'USD',
      status: 'PENDING',
      campaign: { title: 'Test Campaign' },
    };
    mockDb.payoutRequest.create.mockResolvedValue(created);

    const res = await POST(makeRequest('http://localhost/api/portal/payout-requests', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'c-1', requestedAmount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.requestedAmount).toBe(500);
  });

  it('returns 403 when no accepted proposal', async () => {
    mockDb.campaignProposal.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest('http://localhost/api/portal/payout-requests', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'c-1', requestedAmount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('No accepted proposal for this campaign');
  });
});
