/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/[id]/negotiations/route';
import { PATCH } from '@/app/api/campaigns/[id]/negotiations/[offerId]/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    negotiationOffer: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    creator: { findMany: jest.fn() },
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
function makeOfferParams(id: string, offerId: string) { return { params: Promise.resolve({ id, offerId }) }; }

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
  mockDb.creator.findMany.mockResolvedValue([]);
});

describe('GET /api/campaigns/[id]/negotiations', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/negotiations'), makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('returns negotiations list', async () => {
    const negotiations = [{ id: 'neg-1', creatorId: 'cr-1', offeredRate: 500, status: 'PENDING' }];
    mockDb.negotiationOffer.findMany.mockResolvedValue(negotiations);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/negotiations'), makeParams('camp-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.negotiations).toEqual([{ ...negotiations[0], creator: null }]);
  });

  /* Every offer carries its own currency, so the running budget line has to be
     one total per currency. It used to be two scalars summed across currencies
     and rendered with offers[0].currency -- the newest offer's, which is not a
     property of the sum. */
  it('totals accepted and pending offers per currency', async () => {
    mockDb.negotiationOffer.findMany.mockResolvedValue([
      { id: 'n1', creatorId: 'cr-1', currency: 'INR', offeredRate: 40000, status: 'ACCEPTED', finalRate: 40000 },
      { id: 'n2', creatorId: 'cr-2', currency: 'EUR', offeredRate: 500, status: 'ACCEPTED', finalRate: null },
      { id: 'n3', creatorId: 'cr-3', currency: 'INR', offeredRate: 10000, status: 'PENDING' },
      { id: 'n4', creatorId: 'cr-4', currency: 'INR', offeredRate: 5000, status: 'REJECTED' },
    ]);

    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/negotiations'), makeParams('camp-1'));
    const body = await res.json();

    expect(body.aggregate.acceptedTotals).toEqual([
      { currency: 'INR', amount: 40000 },
      { currency: 'EUR', amount: 500 },
    ]);
    expect(body.aggregate.pendingTotals).toEqual([{ currency: 'INR', amount: 10000 }]);
  });

  it('defaults an offer with no currency to USD rather than its own bucket', async () => {
    mockDb.negotiationOffer.findMany.mockResolvedValue([
      { id: 'n1', creatorId: 'cr-1', offeredRate: 100, status: 'ACCEPTED', finalRate: null },
    ]);

    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/negotiations'), makeParams('camp-1'));
    const body = await res.json();

    expect(body.aggregate.acceptedTotals).toEqual([{ currency: 'USD', amount: 100 }]);
  });

  /* NegotiationOffer stores creatorId as a bare string with no relation. The
     page used to resolve it client-side against whatever its creator picker had
     fetched — which was the first 20 creators, and only after that modal had
     been opened once. Every other offer rendered as "cmt1m1wq...". */
  it('resolves each offer to its creator, scoped to the org', async () => {
    mockDb.negotiationOffer.findMany.mockResolvedValue([
      { id: 'neg-1', creatorId: 'cr-1' },
      { id: 'neg-2', creatorId: 'cr-2' },
      { id: 'neg-3', creatorId: 'cr-1' },
    ]);
    mockDb.creator.findMany.mockResolvedValue([
      { id: 'cr-1', name: 'Ada', handle: 'ada' },
      { id: 'cr-2', name: 'Grace', handle: 'grace' },
    ]);

    const body = await (await GET(makeRequest('http://localhost/api/campaigns/camp-1/negotiations'), makeParams('camp-1'))).json();

    expect(body.negotiations.map((n: any) => n.creator?.name)).toEqual(['Ada', 'Grace', 'Ada']);
    // Asked for once, de-duplicated, and never outside this org.
    expect(mockDb.creator.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['cr-1', 'cr-2'] }, orgId: 'org-1' },
      select: { id: true, name: true, handle: true },
    });
  });

  it('leaves creator null rather than inventing a name for a deleted one', async () => {
    mockDb.negotiationOffer.findMany.mockResolvedValue([{ id: 'neg-1', creatorId: 'gone' }]);
    mockDb.creator.findMany.mockResolvedValue([]);

    const body = await (await GET(makeRequest('http://localhost/api/campaigns/camp-1/negotiations'), makeParams('camp-1'))).json();

    expect(body.negotiations[0].creator).toBeNull();
  });

  it('does not query for creators when there are no offers', async () => {
    mockDb.negotiationOffer.findMany.mockResolvedValue([]);
    const body = await (await GET(makeRequest('http://localhost/api/campaigns/camp-1/negotiations'), makeParams('camp-1'))).json();
    expect(body.negotiations).toEqual([]);
    expect(mockDb.creator.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/campaigns/[id]/negotiations', () => {
  it('creates offer', async () => {
    const offer = { id: 'neg-new', offeredRate: 500, status: 'PENDING' };
    mockDb.negotiationOffer.create.mockResolvedValue(offer);

    const res = await POST(makeRequest('http://localhost/api/campaigns/camp-1/negotiations', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c1', offeredRate: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/campaigns/[id]/negotiations/[offerId]', () => {
  it('counters an offer', async () => {
    mockDb.negotiationOffer.findFirst.mockResolvedValue({ id: 'neg-1', campaignId: 'camp-1', orgId: 'org-1', status: 'PENDING', counterRate: null, notes: null });
    mockDb.negotiationOffer.update.mockResolvedValue({ id: 'neg-1', status: 'COUNTERED', counterRate: 750 });

    const res = await PATCH(makeRequest('http://localhost/api/campaigns/camp-1/negotiations/neg-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'COUNTERED', counterRate: 750 }),
      headers: { 'Content-Type': 'application/json' },
    }), makeOfferParams('camp-1', 'neg-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('COUNTERED');
  });

  it('returns 400 when countering without counterRate', async () => {
    mockDb.negotiationOffer.findFirst.mockResolvedValue({ id: 'neg-1', campaignId: 'camp-1', orgId: 'org-1', status: 'PENDING', counterRate: null, notes: null });

    const res = await PATCH(makeRequest('http://localhost/api/campaigns/camp-1/negotiations/neg-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'COUNTERED' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeOfferParams('camp-1', 'neg-1'));
    expect(res.status).toBe(400);
  });
});
