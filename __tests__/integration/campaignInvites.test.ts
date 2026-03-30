/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/[id]/invites/route';
import { POST as RESPOND } from '@/app/api/campaign-invites/respond/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    campaignInvite: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
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

function makeRequest(url: string, options?: RequestInit) { return new NextRequest(url, options); }
function makeParams(id: string) { return { params: Promise.resolve({ id }) }; }

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
});

describe('GET /api/campaigns/[id]/invites', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/invites'), makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('returns invite list', async () => {
    const invites = [{ id: 'inv-1', creatorId: 'c1', status: 'PENDING' }];
    mockDb.campaignInvite.findMany.mockResolvedValue(invites);
    const res = await GET(makeRequest('http://localhost/api/campaigns/camp-1/invites'), makeParams('camp-1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.invites).toEqual(invites);
  });
});

describe('POST /api/campaigns/[id]/invites', () => {
  it('creates invite with token', async () => {
    const invite = { id: 'inv-new', creatorId: 'c1', inviteToken: 'tok_123', status: 'PENDING' };
    mockDb.campaignInvite.create.mockResolvedValue(invite);

    const res = await POST(makeRequest('http://localhost/api/campaigns/camp-1/invites', {
      method: 'POST',
      body: JSON.stringify({ creatorId: 'c1', channel: 'LINK' }),
      headers: { 'Content-Type': 'application/json' },
    }), makeParams('camp-1'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.inviteToken).toBe('tok_123');
  });
});

describe('POST /api/campaign-invites/respond', () => {
  it('accepts invite via token', async () => {
    mockDb.campaignInvite.findUnique.mockResolvedValue({ id: 'inv-1', orgId: 'org-1', status: 'PENDING' });
    mockDb.campaignInvite.update.mockResolvedValue({ id: 'inv-1', status: 'ACCEPTED' });

    const res = await RESPOND(makeRequest('http://localhost/api/campaign-invites/respond', {
      method: 'POST',
      body: JSON.stringify({ token: 'tok_123', action: 'ACCEPTED' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ACCEPTED');
  });

  it('returns 400 for already-responded invite', async () => {
    mockDb.campaignInvite.findUnique.mockResolvedValue({ id: 'inv-1', orgId: 'org-1', status: 'ACCEPTED' });

    const res = await RESPOND(makeRequest('http://localhost/api/campaign-invites/respond', {
      method: 'POST',
      body: JSON.stringify({ token: 'tok_123', action: 'DECLINED' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
  });
});
