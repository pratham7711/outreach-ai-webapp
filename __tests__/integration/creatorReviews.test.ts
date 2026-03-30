/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/[id]/reviews/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    creatorReview: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    creator: { findFirst: jest.fn() },
    creatorUser: { findFirst: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));
jest.mock('@/lib/audit', () => ({
  logAudit: jest.fn(),
  createAuditActor: jest.fn().mockReturnValue({ userId: 'u1', actorEmail: 'a@b.c', actorType: 'user' }),
}));
jest.mock('@/lib/request', () => ({ getRequestIp: jest.fn().mockReturnValue('127.0.0.1') }));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const session = { user: { id: 'user-1', orgId: 'org-1' } };
const mockCampaign = { id: 'camp-1', orgId: 'org-1', deletedAt: null };

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
});

describe('GET /api/campaigns/[id]/reviews', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1/reviews');
    const res = await GET(req, makeParams('camp-1'));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/campaigns/[id]/reviews', () => {
  it('creates review and updates creator rating', async () => {
    mockDb.creatorReview.findFirst.mockResolvedValue(null);
    mockDb.creatorReview.create.mockResolvedValue({
      id: 'rev-1',
      rating: 5,
      tags: ['on_time'],
      comment: 'Great!',
    });
    mockDb.creator.findFirst.mockResolvedValue({ id: 'c1', handle: 'testcreator' });
    mockDb.creatorReview.findMany.mockResolvedValue([{ rating: 5 }, { rating: 4 }]);
    mockDb.creatorUser.findFirst.mockResolvedValue({ id: 'cu1', handle: 'testcreator' });
    mockDb.creatorUser.update.mockResolvedValue({ id: 'cu1', avgRating: 4.5 });

    const req = makeRequest('http://localhost/api/campaigns/camp-1/reviews', {
      method: 'POST',
      body: JSON.stringify({
        creatorId: 'c1',
        rating: 5,
        tags: ['on_time'],
        comment: 'Great!',
      }),
    });

    const res = await POST(req, makeParams('camp-1'));
    expect(res.status).toBe(201);
  });

  it('returns 409 for duplicate review', async () => {
    mockDb.creatorReview.findFirst.mockResolvedValue({
      id: 'rev-existing',
      rating: 4,
      tags: ['responsive'],
      comment: 'Already reviewed',
    });

    const req = makeRequest('http://localhost/api/campaigns/camp-1/reviews', {
      method: 'POST',
      body: JSON.stringify({
        creatorId: 'c1',
        rating: 5,
        tags: ['on_time'],
        comment: 'Great!',
      }),
    });

    const res = await POST(req, makeParams('camp-1'));
    expect(res.status).toBe(409);
  });
});
