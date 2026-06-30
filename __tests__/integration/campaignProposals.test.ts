/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/campaigns/[id]/proposals/route';
import { PATCH } from '@/app/api/campaigns/[id]/proposals/[proposalId]/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    campaignProposal: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    creator: { findFirst: jest.fn(), create: jest.fn() },
    activation: { create: jest.fn() },
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
function makeProposalParams(id: string, proposalId: string) { return { params: Promise.resolve({ id, proposalId }) }; }

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
});

describe('GET /api/campaigns/[id]/proposals', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/proposals'), makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('returns proposals list', async () => {
    const proposals = [{ id: 'p-1', proposedRate: 500, status: 'PENDING', creatorUser: { name: 'Test' } }];
    mockDb.campaignProposal.findMany.mockResolvedValue(proposals);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/proposals'), makeParams('camp-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.proposals).toEqual(proposals);
  });
});

describe('PATCH /api/campaigns/[id]/proposals/[proposalId]', () => {
  const mockProposal = {
    id: 'p-1', campaignId: 'camp-1', status: 'PENDING', proposedRate: 500,
    creatorUser: { id: 'cu-1', name: 'Test Creator', handle: 'testcreator', platform: 'TIKTOK', followersCount: 10000, averageViews: 5000, rate: 400 },
  };

  it('accepts proposal and creates activation', async () => {
    mockDb.campaignProposal.findFirst.mockResolvedValue(mockProposal);
    mockDb.campaignProposal.update.mockResolvedValue({ ...mockProposal, status: 'ACCEPTED' });
    mockDb.creator.findFirst.mockResolvedValue(null);
    mockDb.creator.create.mockResolvedValue({ id: 'creator-new', name: 'Test Creator' });
    mockDb.activation.create.mockResolvedValue({ id: 'act-new', status: 'AWAITING_DRAFT' });

    const res = await PATCH(makeRequest('http://localhost/api/campaigns/camp-1/proposals/p-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'ACCEPTED' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeProposalParams('camp-1', 'p-1'));

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.proposal.status).toBe('ACCEPTED');
    expect(body.activation.id).toBe('act-new');
    expect(mockDb.creator.create).toHaveBeenCalled();
    expect(mockDb.activation.create).toHaveBeenCalled();
  });

  it('rejects proposal without creating activation', async () => {
    mockDb.campaignProposal.findFirst.mockResolvedValue(mockProposal);
    mockDb.campaignProposal.update.mockResolvedValue({ ...mockProposal, status: 'REJECTED' });

    const res = await PATCH(makeRequest('http://localhost/api/campaigns/camp-1/proposals/p-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'REJECTED' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeProposalParams('camp-1', 'p-1'));

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.proposal.status).toBe('REJECTED');
    expect(body.activation).toBeNull();
    expect(mockDb.activation.create).not.toHaveBeenCalled();
  });

  it('returns 400 for already-processed proposal', async () => {
    mockDb.campaignProposal.findFirst.mockResolvedValue({ ...mockProposal, status: 'ACCEPTED' });

    const res = await PATCH(makeRequest('http://localhost/api/campaigns/camp-1/proposals/p-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'REJECTED' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeProposalParams('camp-1', 'p-1'));
    expect(res.status).toBe(400);
  });
});
