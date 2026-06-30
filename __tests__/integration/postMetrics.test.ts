/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/campaigns/[id]/posts/[postId]/route';
import { GET as GETSnapshots } from '@/app/api/campaigns/[id]/posts/[postId]/snapshots/route';
import { POST as POSTSync } from '@/app/api/campaigns/[id]/posts/[postId]/sync/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findFirst: jest.fn(), update: jest.fn() },
    postMetricSnapshot: { findMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));

jest.mock('@/lib/platforms/fetchPostMetrics', () => ({
  fetchPostMetrics: jest.fn().mockResolvedValue({
    platform: 'YOUTUBE',
    platformPostId: 'abc123',
    thumbnailUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
    caption: 'Test Video',
    viewsCount: 5000,
    likesCount: 200,
    commentsCount: 50,
    sharesCount: 10,
    engagementRate: 5.0,
    postedAt: new Date('2026-01-01'),
  }),
}));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: 'user-1', orgId: 'org-1' } };
const mockCampaign = { id: 'camp-1', orgId: 'org-1', postApprovalMode: 'MANUAL', deletedAt: null };
const mockPost = {
  id: 'post-1', campaignId: 'camp-1', platform: 'YOUTUBE',
  postUrl: 'https://youtube.com/watch?v=abc123',
  viewsCount: 1000, likesCount: 50, commentsCount: 10,
  sharesCount: 5, savesCount: 0, reachCount: 0, downloadsCount: 0,
  thumbnailUrl: null, caption: 'Test Video',
};

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

function makeParams(id: string, postId: string) {
  return { params: Promise.resolve({ id, postId }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
  mockDb.post.findFirst.mockResolvedValue(mockPost);
});

// ─── GET /api/campaigns/[id]/posts/[postId] ──────────────────────────────────

describe('GET /api/campaigns/[id]/posts/[postId]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1');
    const res = await GET(req, makeParams('camp-1', 'post-1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when campaign not found', async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1');
    const res = await GET(req, makeParams('camp-1', 'post-1'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when post not found', async () => {
    mockDb.post.findFirst.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1');
    const res = await GET(req, makeParams('camp-1', 'post-1'));
    expect(res.status).toBe(404);
  });

  it('returns post with snapshots', async () => {
    const postWithSnapshots = {
      ...mockPost,
      creator: { id: 'c1', name: 'Test', handle: 'test', avatarUrl: null, platform: 'YOUTUBE' },
      snapshots: [{ id: 's1', viewsCount: 1000, recordedAt: new Date() }],
    };
    mockDb.post.findFirst.mockResolvedValue(postWithSnapshots);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1');
    const res = await GET(req, makeParams('camp-1', 'post-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('post-1');
    expect(body.snapshots).toHaveLength(1);
  });
});

// ─── PATCH manual metrics ─────────────────────────────────────────────────────

describe('PATCH /api/campaigns/[id]/posts/[postId] — manual metrics', () => {
  it('updates metrics and creates snapshot', async () => {
    const updatedPost = { ...mockPost, viewsCount: 2000, likesCount: 100, creator: { id: 'c1', name: 'Test' } };
    mockDb.$transaction.mockResolvedValue([updatedPost, { id: 'snap-1' }]);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1', {
      method: 'PATCH',
      body: JSON.stringify({ viewsCount: 2000, likesCount: 100, commentsCount: 20, sharesCount: 10, savesCount: 5 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1', 'post-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.viewsCount).toBe(2000);
    expect(mockDb.$transaction).toHaveBeenCalled();
  });

  it('returns 400 for invalid metrics', async () => {
    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1', {
      method: 'PATCH',
      body: JSON.stringify({ viewsCount: -1 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1', 'post-1'));
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/campaigns/[id]/posts/[postId]/snapshots ─────────────────────────

describe('GET /api/campaigns/[id]/posts/[postId]/snapshots', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1/snapshots');
    const res = await GETSnapshots(req, makeParams('camp-1', 'post-1'));
    expect(res.status).toBe(401);
  });

  it('returns snapshots for a post', async () => {
    const mockSnapshots = [
      { id: 's1', viewsCount: 500, recordedAt: new Date('2026-01-01') },
      { id: 's2', viewsCount: 1000, recordedAt: new Date('2026-01-02') },
    ];
    mockDb.postMetricSnapshot.findMany.mockResolvedValue(mockSnapshots);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1/snapshots');
    const res = await GETSnapshots(req, makeParams('camp-1', 'post-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.snapshots).toHaveLength(2);
  });
});

// ─── POST /api/campaigns/[id]/posts/[postId]/sync ─────────────────────────────

describe('POST /api/campaigns/[id]/posts/[postId]/sync', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1/sync', { method: 'POST' });
    const res = await POSTSync(req, makeParams('camp-1', 'post-1'));
    expect(res.status).toBe(401);
  });

  it('syncs metrics from platform and creates snapshot', async () => {
    const synced = {
      ...mockPost, viewsCount: 5000, likesCount: 200,
      creator: { id: 'c1', name: 'Test' },
      snapshots: [{ id: 's1', viewsCount: 5000 }],
    };
    mockDb.$transaction.mockResolvedValue([synced, { id: 'snap-new' }]);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts/post-1/sync', { method: 'POST' });
    const res = await POSTSync(req, makeParams('camp-1', 'post-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.viewsCount).toBe(5000);
    expect(mockDb.$transaction).toHaveBeenCalled();
  });
});
