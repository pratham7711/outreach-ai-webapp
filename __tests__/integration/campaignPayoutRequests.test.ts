/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/[id]/payout-requests/route';
import { PATCH } from '@/app/api/campaigns/[id]/payout-requests/[requestId]/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    payoutRequest: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/audit', () => ({ logAudit: jest.fn(), createAuditActor: jest.fn().mockReturnValue({ userId: 'u1', actorEmail: 'a@b.c', actorType: 'user' }) }));
jest.mock('@/lib/request', () => ({ getRequestIp: jest.fn().mockReturnValue('127.0.0.1') }));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const session = { user: { id: 'user-1', orgId: 'org-1' } };
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
    const requests = [{ id: 'pr-1', requestedAmount: 500, status: 'PENDING' }];
    mockDb.payoutRequest.findMany.mockResolvedValue(requests);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests'), makeParams('camp-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.payoutRequests).toEqual(requests);
  });
});

describe('POST /api/campaigns/[id]/payout-requests', () => {
  it('creates payout request', async () => {
    const pr = { id: 'pr-new', requestedAmount: 500, status: 'PENDING' };
    mockDb.payoutRequest.create.mockResolvedValue(pr);

    const res = await POST(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c1', requestedAmount: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/campaigns/[id]/payout-requests/[requestId]', () => {
  it('approves payout request', async () => {
    mockDb.payoutRequest.findFirst.mockResolvedValue({ id: 'pr-1', campaignId: 'camp-1', orgId: 'org-1', status: 'PENDING' });
    mockDb.payoutRequest.update.mockResolvedValue({ id: 'pr-1', status: 'APPROVED', processedAt: new Date() });

    const res = await PATCH(makeRequest('http://localhost/api/campaigns/camp-1/payout-requests/pr-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'APPROVED' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeReqParams('camp-1', 'pr-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('APPROVED');
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
