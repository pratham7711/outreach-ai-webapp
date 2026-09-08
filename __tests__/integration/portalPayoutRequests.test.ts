/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/portal/payout-requests/route';

jest.mock('@/lib/db', () => ({
  db: {
    payoutRequest: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    campaignProposal: { findFirst: jest.fn() },
    campaign: { findUnique: jest.fn() },
    creator: { findFirst: jest.fn() },
    activation: { findFirst: jest.fn() },
  },
}));

jest.mock('@/lib/creator-auth', () => ({
  getCreatorSession: jest.fn(),
}));

jest.mock('@/lib/marketplace/earnings', () => ({
  computeCreatorEarnings: jest.fn(),
}));

import { db } from '@/lib/db';
import { getCreatorSession } from '@/lib/creator-auth';
import { computeCreatorEarnings } from '@/lib/marketplace/earnings';

const mockSession = getCreatorSession as jest.Mock;
const mockDb = db as any;
const mockEarnings = computeCreatorEarnings as jest.Mock;

/** approvedMinor is MINOR units; 50_000 minor = 500.00 major. */
const earned = (approvedMinor: number, campaignId = 'c-1') => [
  { campaignId, approvedMinor, pendingMinor: 0, currency: 'USD' },
];

const session = { id: 'sess-1', creatorUserId: 'cu-1', email: 'test@x.com', name: 'Test', handle: 'test' };

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue(session);
  mockDb.payoutRequest.findFirst.mockResolvedValue(null);
  mockDb.payoutRequest.findMany.mockResolvedValue([]);
  mockEarnings.mockResolvedValue([]);
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
    mockDb.campaignProposal.findFirst.mockResolvedValue({ id: 'prop-1', status: 'ACCEPTED', proposedRate: 500 });
    mockDb.campaign.findUnique.mockResolvedValue({ orgId: 'org-1', currency: 'USD' });
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

  it('returns 403 when no accepted proposal and not joined', async () => {
    mockDb.campaignProposal.findFirst.mockResolvedValue(null);
    mockDb.campaign.findUnique.mockResolvedValue({ orgId: 'org-1', currency: 'USD' });
    mockDb.creator.findFirst.mockResolvedValue({ id: 'creator-1' });
    mockDb.activation.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest('http://localhost/api/portal/payout-requests', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'c-1', requestedAmount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('No accepted proposal for this campaign');
  });

  it('creates payout request when joined via marketplace activation', async () => {
    mockDb.campaignProposal.findFirst.mockResolvedValue(null);
    mockDb.campaign.findUnique.mockResolvedValue({ orgId: 'org-1', currency: 'USD' });
    mockDb.creator.findFirst.mockResolvedValue({ id: 'creator-1' });
    mockDb.activation.findFirst.mockResolvedValue({ id: 'act-1' });
    mockEarnings.mockResolvedValue(earned(30_000));
    mockDb.payoutRequest.create.mockResolvedValue({
      id: 'pr-2',
      requestedAmount: 300,
      currency: 'USD',
      status: 'PENDING',
      campaign: { title: 'Marketplace Camp' },
    });

    const res = await POST(makeRequest('http://localhost/api/portal/payout-requests', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'c-1', requestedAmount: 300 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.requestedAmount).toBe(300);
  });
});

/* The amount was any positive float, nothing called computeCreatorEarnings, and
   the same request could be filed without limit. All three were the same bug:
   the API took the creator's word for what they were owed. */
describe('POST /api/portal/payout-requests — entitlement', () => {
  const post = (body: Record<string, unknown>) =>
    POST(makeRequest('http://localhost/api/portal/payout-requests', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }));

  const joinedMarketplace = (approvedMinor: number) => {
    mockDb.campaignProposal.findFirst.mockResolvedValue(null);
    mockDb.campaign.findUnique.mockResolvedValue({ orgId: 'org-1', currency: 'INR' });
    mockDb.creator.findFirst.mockResolvedValue({ id: 'creator-1' });
    mockDb.activation.findFirst.mockResolvedValue({ id: 'act-1' });
    mockEarnings.mockResolvedValue(earned(approvedMinor));
    mockDb.payoutRequest.create.mockResolvedValue({ id: 'pr-x' });
  };

  it('rejects more than the approved-but-unpaid earnings', async () => {
    joinedMarketplace(30_000); // 300.00
    const res = await post({ campaignId: 'c-1', requestedAmount: 1_000_000 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.availableAmount).toBe(300);
    expect(mockDb.payoutRequest.create).not.toHaveBeenCalled();
  });

  it('allows exactly the approved balance', async () => {
    joinedMarketplace(30_000);
    const res = await post({ campaignId: 'c-1', requestedAmount: 300 });
    expect(res.status).toBe(201);
    expect(mockDb.payoutRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestedAmount: 300 }) }),
    );
  });

  it('rejects any amount when nothing is approved yet', async () => {
    joinedMarketplace(0);
    const res = await post({ campaignId: 'c-1', requestedAmount: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no approved earnings/i);
  });

  it('subtracts what an APPROVED request already claimed', async () => {
    joinedMarketplace(30_000); // 300.00 earned
    mockDb.payoutRequest.findMany.mockResolvedValue([{ requestedAmount: 250 }]);
    const res = await post({ campaignId: 'c-1', requestedAmount: 100 });
    expect(res.status).toBe(400);
    expect((await res.json()).availableAmount).toBe(50);
  });

  it('409s when a PENDING request already exists for this campaign', async () => {
    joinedMarketplace(30_000);
    mockDb.payoutRequest.findFirst.mockResolvedValue({ id: 'pr-open' });
    const res = await post({ campaignId: 'c-1', requestedAmount: 10 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already have a payout request pending/i);
    expect(mockDb.payoutRequest.create).not.toHaveBeenCalled();
    expect(mockDb.payoutRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: 'c-1', creatorUserId: 'cu-1', status: 'PENDING' },
      }),
    );
  });

  it("stores the campaign's currency and ignores one sent on the body", async () => {
    joinedMarketplace(30_000);
    const res = await post({ campaignId: 'c-1', requestedAmount: 10, currency: 'BTC' });
    expect(res.status).toBe(201);
    expect(mockDb.payoutRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'INR' }) }),
    );
  });

  it('counts an ACCEPTED proposal rate as entitlement in the negotiated flow', async () => {
    mockDb.campaignProposal.findFirst.mockResolvedValue({ id: 'prop-1', proposedRate: 800 });
    mockDb.campaign.findUnique.mockResolvedValue({ orgId: 'org-1', currency: 'USD' });
    mockDb.creator.findFirst.mockResolvedValue({ id: 'creator-1' });
    mockEarnings.mockResolvedValue([]);
    mockDb.payoutRequest.create.mockResolvedValue({ id: 'pr-y' });

    expect((await post({ campaignId: 'c-1', requestedAmount: 800 })).status).toBe(201);
    expect((await post({ campaignId: 'c-1', requestedAmount: 800.01 })).status).toBe(400);
  });
});
