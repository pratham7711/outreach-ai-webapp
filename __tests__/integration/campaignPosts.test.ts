/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/campaigns/[id]/posts/route';
import { PATCH } from '@/app/api/campaigns/[id]/posts/[postId]/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    creator: { findFirst: jest.fn(), create: jest.fn() },
    creatorSocialAccount: { findFirst: jest.fn() },
    activation: { findFirst: jest.fn() },
    post: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    viewFraudFlag: { findMany: jest.fn() },
  },
}));

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }));

/* A TikTok link is the only form that carries both a post id and a handle --
   YouTube's watch?v= names no channel and its /@handle/ form names no video --
   so the auto-add cases below use one, and these two keep it off the network. */
jest.mock('@/lib/platforms/tiktokToken', () => ({ getTikTokTokenForCreator: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/platforms/instagramToken', () => ({ getInstagramAccountForCreator: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/platforms/creatorProfile', () => ({
  ...jest.requireActual('@/lib/platforms/creatorProfile'),
  readCreatorProfile: jest.fn().mockResolvedValue({ ok: false, reason: 'unreadable' }),
}));

jest.mock('@/lib/platforms/fetchPostMetrics', () => ({
  ...jest.requireActual('@/lib/platforms/fetchPostMetrics'),
  fetchYouTubeMetrics: jest.fn(),
  fetchYouTubeMetricsBatch: jest.fn().mockResolvedValue(new Map()),
  fetchTikTokMetrics: jest.fn(),
  fetchInstagramMetrics: jest.fn(),
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

const authedSession = { user: { id: 'user-1', orgId: 'org-1', role: 'ADMIN' } };
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
  mockDb.creatorSocialAccount.findFirst.mockResolvedValue(null);
  // The duplicate check runs on every add, so "no post looks like this one" is
  // the default every case here starts from.
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.viewFraudFlag.findMany.mockResolvedValue([]);
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
    // GET enriches each post with an unresolved-fraud-flag presence flag (M4).
    expect(body.posts).toEqual(mockPosts.map((p) => ({ ...p, hasOpenFraudFlag: false, complianceFlags: [] })));
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

  /* The same video copied out of two browsers carries different tracking
     parameters, which is why the guard matches on the platform's post id and
     not on the URL string. */
  it('refuses a post the campaign already has, whatever the URL says', async () => {
    mockDb.post.findMany.mockResolvedValue([
      { id: 'post-1', campaignId: 'camp-1', campaign: { title: 'This One' }, creator: { handle: '@jane' } },
    ]);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts', {
      method: 'POST',
      body: JSON.stringify({
        postUrl: 'https://youtube.com/watch?v=abc123&feature=share',
        creatorId: 'c1',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, makeParams('camp-1'));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('duplicate_post');
    expect(mockDb.post.create).not.toHaveBeenCalled();
  });

  it('asks before counting a post that another campaign already tracks', async () => {
    mockDb.post.findMany.mockResolvedValue([
      { id: 'post-9', campaignId: 'camp-other', campaign: { title: 'Spring Drop' }, creator: { handle: '@jane' } },
    ]);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts', {
      method: 'POST',
      body: JSON.stringify({ postUrl: 'https://youtube.com/watch?v=abc123', creatorId: 'c1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('duplicate_post_other_campaign');
    // Named, so the dialog can say which campaign rather than just "somewhere".
    expect(body.campaigns).toEqual([{ id: 'camp-other', name: 'Spring Drop' }]);
    expect(mockDb.post.create).not.toHaveBeenCalled();
  });

  it('adds it once the operator says yes', async () => {
    mockDb.post.findMany.mockResolvedValue([
      { id: 'post-9', campaignId: 'camp-other', campaign: { title: 'Spring Drop' }, creator: { handle: '@jane' } },
    ]);
    mockDb.post.create.mockResolvedValue({ id: 'post-new', creator: { id: 'c1', handle: '@jane' } });

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts', {
      method: 'POST',
      body: JSON.stringify({
        postUrl: 'https://youtube.com/watch?v=abc123',
        creatorId: 'c1',
        allowDuplicate: true,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, makeParams('camp-1'));

    expect(res.status).toBe(201);
    expect(mockDb.post.create).toHaveBeenCalled();
  });

  /* The roster is a record of who we track, not a permit list to fill in first:
     a link from somebody new used to be a 404 that sent the operator away to
     the Creators page with the rest of the batch unsubmitted. */
  it('adds a creator the roster has never seen rather than refusing the post', async () => {
    // Null for the handle lookup that decides there is nobody yet, then the
    // freshly created row for the route's own re-read by id.
    mockDb.creator.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'c-new', orgId: 'org-1', handle: 'newface', deletedAt: null });
    mockDb.creator.create.mockResolvedValue({ id: 'c-new', name: 'newface', handle: 'newface' });
    mockDb.post.create.mockResolvedValue({ id: 'post-new', creator: { id: 'c-new', handle: 'newface' } });

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts', {
      method: 'POST',
      body: JSON.stringify({ postUrl: 'https://www.tiktok.com/@newface/video/7684142520015621384' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.creatorAutoAdded).toBe('newface');
    expect(mockDb.creator.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ handle: 'newface', orgId: 'org-1' }) })
    );
  });

  it('still refuses when the seat is not allowed to add creators', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', orgId: 'org-1', role: 'VIEWER' } });
    mockDb.creator.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/campaigns/camp-1/posts', {
      method: 'POST',
      body: JSON.stringify({ postUrl: 'https://www.tiktok.com/@newface/video/7684142520015621384' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, makeParams('camp-1'));

    expect(res.status).toBe(404);
    expect(mockDb.creator.create).not.toHaveBeenCalled();
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
