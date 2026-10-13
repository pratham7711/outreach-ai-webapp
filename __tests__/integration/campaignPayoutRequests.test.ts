/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/[id]/payout-requests/route';
import { PATCH } from '@/app/api/campaigns/[id]/payout-requests/[requestId]/route';

/* Payouts are switched off in production (lib/payouts/switch.ts), and every
   payout route then answers 404 before reading the session -- that half is
   pinned by __tests__/unit/api/payoutRoutesOff.test.ts. This suite covers the
   other half: how the routes behave when the switch is back on. */
jest.mock("@/lib/payouts/switch", () => ({ PAYOUTS_ENABLED: true }));

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    payoutRequest: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    // The list joins creator names by hand (PayoutRequest.creatorId has no relation).
    creator: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
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
function makeReqParams(id: string, requestId: string) { return { params: Promise.resolve({ id, requestId }) }; }

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
});

describe('GET /api/campaigns/[id]/payout-requests', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests'), makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('returns payout requests list', async () => {
    const requests = [{ id: 'pr-1', creatorId: 'c1', requestedAmount: 500, status: 'PENDING' }];
    mockDb.payoutRequest.findMany.mockResolvedValue(requests);
    const creator = { id: 'c1', name: 'Cee Creator', handle: 'cee' };
    mockDb.creator.findMany.mockResolvedValue([creator]);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests'), makeParams('camp-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    // An approver reads a name before paying, so each row carries its creator.
    expect(body.payoutRequests).toEqual([{ ...requests[0], creator }]);
    expect(mockDb.creator.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['c1'] }, orgId: 'org-1' });
  });
});

describe('POST /api/campaigns/[id]/payout-requests', () => {
  it('creates payout request', async () => {
    const pr = { id: 'pr-new', requestedAmount: 500, status: 'PENDING' };
    mockDb.creator.findFirst.mockResolvedValue({ id: 'c1' });
    mockDb.payoutRequest.create.mockResolvedValue(pr);

    const res = await POST(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c1', requestedAmount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(201);
  });

  it('will not file a request for another org\'s creator', async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    const res = await POST(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c-other-org', requestedAmount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(404);
    expect(mockDb.payoutRequest.create).not.toHaveBeenCalled();
  });

  /* Money writes are payments:manage, which MEMBER does not hold. */
  it('refuses a MEMBER', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', orgId: 'org-1', role: 'MEMBER' } });
    const res = await POST(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c1', requestedAmount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/campaigns/[id]/payout-requests/[requestId]', () => {
  it('approves payout request', async () => {
    mockDb.payoutRequest.findFirst.mockResolvedValue({ id: 'pr-1', campaignId: 'camp-1', orgId: 'org-1', status: 'PENDING' });
    mockDb.payoutRequest.updateMany.mockResolvedValue({ count: 1 });
    mockDb.payoutRequest.findUniqueOrThrow.mockResolvedValue({ id: 'pr-1', status: 'APPROVED', processedAt: new Date() });

    const res = await PATCH(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests/pr-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'APPROVED' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeReqParams('camp-1', 'pr-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('APPROVED');
  });

  it('409s an approval that lost the race to another decision', async () => {
    mockDb.payoutRequest.findFirst.mockResolvedValue({ id: 'pr-1', campaignId: 'camp-1', orgId: 'org-1', status: 'PENDING' });
    mockDb.payoutRequest.updateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests/pr-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'APPROVED' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeReqParams('camp-1', 'pr-1'));
    expect(res.status).toBe(409);
    expect(mockDb.payoutRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pr-1', orgId: 'org-1', status: 'PENDING' } })
    );
  });

  it('returns 400 when already processed', async () => {
    mockDb.payoutRequest.findFirst.mockResolvedValue({ id: 'pr-1', campaignId: 'camp-1', orgId: 'org-1', status: 'APPROVED' });

    const res = await PATCH(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests/pr-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'REJECTED' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeReqParams('camp-1', 'pr-1'));
    expect(res.status).toBe(400);
  });
});
