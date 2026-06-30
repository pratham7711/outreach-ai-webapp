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
});

describe('GET /api/campaigns/[id]/negotiations', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/negotiations'), makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('returns negotiations list', async () => {
    const negotiations = [{ id: 'neg-1', offeredRate: 500, status: 'PENDING' }];
    mockDb.negotiationOffer.findMany.mockResolvedValue(negotiations);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/negotiations'), makeParams('camp-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.negotiations).toEqual(negotiations);
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
