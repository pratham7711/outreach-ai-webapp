/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/portal/me/route';

jest.mock('@/lib/db', () => ({
  db: {
    creatorUser: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('@/lib/creator-auth', () => ({
  getCreatorSession: jest.fn(),
}));

import { db } from '@/lib/db';
import { getCreatorSession } from '@/lib/creator-auth';

const mockSession = getCreatorSession as jest.Mock;
const mockDb = db as any;

const session = { id: 'sess-1', creatorUserId: 'cu-1', email: 'test@x.com', name: 'Test', handle: 'testhandle' };

const profileData = {
  id: 'cu-1',
  email: 'test@x.com',
  name: 'Test',
  handle: 'testhandle',
  avatarUrl: null,
  bio: null,
  platform: 'TIKTOK',
  followersCount: 0,
  averageViews: 0,
  rate: null,
  boostRate: null,
  lifetimeEarnings: 0,
  cpm: 0,
  averageRating: 0,
  reviewCount: 0,
  niches: [],
  bankAccountName: null,
  createdAt: new Date().toISOString(),
};

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue(session);
});

describe('PATCH /api/portal/me', () => {
  it('returns 401 when no session', async () => {
    mockSession.mockResolvedValue(null);
    const res = await PATCH(makeRequest('http://localhost/api/portal/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(401);
  });

  it('updates profile successfully', async () => {
    const updated = { ...profileData, name: 'Updated Name', bio: 'Hello world' };
    mockDb.creatorUser.update.mockResolvedValue(updated);

    const res = await PATCH(makeRequest('http://localhost/api/portal/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name', bio: 'Hello world' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Name');
    expect(body.bio).toBe('Hello world');
  });

  it('returns 409 when handle already taken', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValue({ id: 'other-user', handle: 'taken' });

    const res = await PATCH(makeRequest('http://localhost/api/portal/me', {
      method: 'PATCH',
      body: JSON.stringify({ handle: 'taken' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Handle already taken');
  });

  it('returns 400 for invalid handle format', async () => {
    const res = await PATCH(makeRequest('http://localhost/api/portal/me', {
      method: 'PATCH',
      body: JSON.stringify({ handle: 'INVALID HANDLE!' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
  });
});
