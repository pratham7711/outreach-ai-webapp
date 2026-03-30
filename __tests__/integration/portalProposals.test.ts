/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/portal/proposals/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    campaignProposal: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
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

describe('GET /api/portal/proposals', () => {
  it('returns 401 when no session', async () => {
    mockSession.mockResolvedValue(null);
    const res = await GET(makeRequest('http://localhost/api/portal/proposals'));
    expect(res.status).toBe(401);
  });

  it('returns proposals list', async () => {
    const proposals = [{ id: 'p-1', proposedRate: 500, status: 'PENDING', campaign: { title: 'Test' } }];
    mockDb.campaignProposal.findMany.mockResolvedValue(proposals);

    const res = await GET(makeRequest('http://localhost/api/portal/proposals'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.proposals).toEqual(proposals);
  });
});

describe('POST /api/portal/proposals', () => {
  it('creates proposal', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', enrollmentOpen: true });
    mockDb.campaignProposal.findFirst.mockResolvedValue(null);
    mockDb.campaignProposal.create.mockResolvedValue({ id: 'p-new', proposedRate: 500, status: 'PENDING', campaign: { id: 'camp-1', title: 'Test' } });

    const res = await POST(makeRequest('http://localhost/api/portal/proposals', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'camp-1', proposedRate: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(201);
  });

  it('returns 409 when already proposed', async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', enrollmentOpen: true });
    mockDb.campaignProposal.findFirst.mockResolvedValue({ id: 'existing' });

    const res = await POST(makeRequest('http://localhost/api/portal/proposals', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'camp-1', proposedRate: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(409);
  });

  it('returns 404 for closed campaign', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest('http://localhost/api/portal/proposals', {
      method: 'POST',
      body: JSON.stringify({ campaignId: 'camp-closed', proposedRate: 500 }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(404);
  });
});
