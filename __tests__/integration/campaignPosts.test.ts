/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/[id]/posts/route';
import { PATCH } from '@/app/api/campaigns/[id]/posts/[postId]/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    creator: { findFirst: jest.fn() },
    activation: { findFirst: jest.fn() },
    post: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));

jest.mock('@/lib/platforms/fetchPostMetrics', () => ({
  fetchPostMetrics: jest.fn().mockResolvedValue({
    platform: 'YOUTUBE',
    platformPostId: 'abc123',
    thumbnailUrl: null,
    caption: 'Test Video',
    viewsCount: 1000,
    likesCount: 50,
    commentsCount: 10,
    engagementRate: 6.0,
    postedAt: new Date('2026-01-01'),
  }),
}));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: 'user-1', orgId: 'org-1' } };
const mockCampaign = { id: 'camp-1', orgId: 'org-1', postApprovalMode: 'MANUAL', deletedAt: null };

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePostParams(id: string, postId: string) {
  return { params: Promise.resolve({ id, postId }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
  mockDb.creator.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1', deletedAt: null });
});

describe('GET /api/campaigns/[id]/posts', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts');
    const res = await GET(req, makeParams('camp-1'));
    expect(res.status).toBe(401);
  });

  it('returns posts list', async () => {
    const mockPosts = [{ id: 'post-1', platform: 'YOUTUBE', creator: { id: 'c1', name: 'Test' } }];
    mockDb.post.findMany.mockResolvedValue(mockPosts);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts');
    const res = await GET(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.posts).toEqual(mockPosts);
  });
});

describe('POST /api/campaigns/[id]/posts', () => {
  it('creates post and returns 201', async () => {
    const created = { id: 'post-new', platform: 'YOUTUBE', status: 'PENDING_REVIEW', creator: { id: 'c1', name: 'Test' } };
    mockDb.post.create.mockResolvedValue(created);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts', {
      method: 'POST',
      body: JSON.stringify({ postUrl: 'https://youtube.com/watch?v=abc123', creatorId: 'c1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe('post-new');
  });
});

describe('PATCH /api/campaigns/[id]/posts/[postId]', () => {
  it('approves a post', async () => {
    mockDb.post.findFirst.mockResolvedValue({ id: 'post-1', campaignId: 'camp-1', status: 'PENDING_REVIEW' });
    const updated = { id: 'post-1', status: 'APPROVED', creator: { id: 'c1', name: 'Test' } };
    mockDb.post.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'APPROVED' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makePostParams('camp-1', 'post-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('APPROVED');
  });

  it('rejects a post with reason', async () => {
    mockDb.post.findFirst.mockResolvedValue({ id: 'post-1', campaignId: 'camp-1', status: 'PENDING_REVIEW' });
    const updated = { id: 'post-1', status: 'REJECTED', rejectionReason: 'Low quality', creator: { id: 'c1', name: 'Test' } };
    mockDb.post.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'REJECTED', rejectionReason: 'Low quality' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makePostParams('camp-1', 'post-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('REJECTED');
  });
});
