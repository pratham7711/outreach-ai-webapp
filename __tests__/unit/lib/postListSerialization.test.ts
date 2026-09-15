/**
 * @jest-environment node
 *
 * The post-list wire contract.
 *
 * Two things are being pinned here. The first is that `toPostDto` is the only
 * decision about what leaves the server, so the importer's `__cc` bag -- 39.5%
 * of this response before it was removed, and a verbatim duplicate of
 * CcPost.raw -- cannot come back by someone widening a Prisma `select`. The
 * second is that JSON and protobuf carry the same object: they are produced
 * from one DTO, and a round trip has to return it unchanged, or the opt-in
 * encoding would quietly describe different posts from the default one.
 */
import {
  toPostDto,
  encodePostList,
  decodePostList,
  wantsProtobuf,
  POST_LIST_CONTENT_TYPE,
  type PostDto,
} from '@/lib/serialization/postList';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'post-1',
  platform: 'TIKTOK',
  platformPostId: '7123456789',
  postUrl: 'https://www.tiktok.com/@someone/video/7123456789',
  thumbnailUrl: 'https://cdn.example/thumb.webp',
  caption: 'a caption',
  mediaType: 'REEL',
  postedAt: new Date('2026-04-02T13:45:23.000Z'),
  viewsCount: 10294,
  likesCount: 812,
  commentsCount: 18,
  sharesCount: 4,
  savesCount: 2,
  downloadsCount: 0,
  engagementRate: 8.0629,
  status: 'APPROVED',
  fetchState: 'LIVE',
  rejectionReason: null,
  lastSyncedAt: new Date('2026-09-03T09:04:15.401Z'),
  authorProfilePic: null,
  createdAt: new Date('2026-07-02T07:22:59.073Z'),
  platformMetrics: { __measured: ['views', 'likes'] },
  creator: { id: 'c1', name: 'Someone', handle: 'someone', avatarUrl: null },
  snapshots: [{ id: 's1', viewsCount: 9000, recordedAt: new Date('2026-09-01T00:00:00.000Z') }],
  ...over,
});

describe('toPostDto', () => {
  it('drops the importer bag and keeps only the two rendered keys', () => {
    const dto = toPostDto(
      row({
        platformMetrics: {
          __cc: { _id: 'cc-1', 'latestViews/Engagement': 999, viewsPullable: true },
          __stat: { views: 12 },
          __measured: ['views'],
          __lastFetch: { reason: 'not-configured', at: '2026-09-03T09:04:15.401Z', via: 'api' },
        },
      }),
      false,
      [],
    );

    expect(JSON.stringify(dto)).not.toContain('__cc');
    expect(JSON.stringify(dto)).not.toContain('__stat');
    expect(dto.platformMetrics).toEqual({
      __measured: ['views'],
      __lastFetch: { reason: 'not-configured', at: '2026-09-03T09:04:15.401Z', via: 'api' },
    });
  });

  it('carries no post field the posts tab does not render', () => {
    const dto = toPostDto(row({ syncFailCount: 3, syncDisabledAt: new Date(), reachCount: 5 }), false, []);
    expect(dto).not.toHaveProperty('syncFailCount');
    expect(dto).not.toHaveProperty('syncDisabledAt');
    expect(dto).not.toHaveProperty('reachCount');
  });

  it('reduces a bag with nothing renderable in it to null', () => {
    expect(toPostDto(row({ platformMetrics: { __cc: { _id: 'x' } } }), false, []).platformMetrics).toBeNull();
    expect(toPostDto(row({ platformMetrics: null }), false, []).platformMetrics).toBeNull();
  });

  it('normalises dates to ISO strings and missing ones to null', () => {
    const dto = toPostDto(row({ lastSyncedAt: null, authorProfilePic: null }), true, []);
    expect(dto.postedAt).toBe('2026-04-02T13:45:23.000Z');
    expect(dto.lastSyncedAt).toBeNull();
    expect(dto.authorProfilePic).toBeNull();
    expect(dto.hasOpenFraudFlag).toBe(true);
  });
});

describe('protobuf transport', () => {
  const dto = (over: Partial<PostDto> = {}): PostDto => ({
    ...toPostDto(row(), false, [{ code: 'POSTED_AFTER_DEADLINE', severity: 'error', message: 'late' }]),
    ...over,
  });

  it('round-trips a post unchanged', () => {
    const before = [dto()];
    expect(decodePostList(encodePostList(before))).toEqual(before);
  });

  it('round-trips nulls, empty lists and a null creator', () => {
    const before = [
      dto({
        thumbnailUrl: null,
        caption: null,
        mediaType: null,
        rejectionReason: null,
        lastSyncedAt: null,
        authorProfilePic: null,
        createdAt: null,
        platformMetrics: null,
        creator: null,
        snapshots: [],
        complianceFlags: [],
      }),
    ];
    expect(decodePostList(encodePostList(before))).toEqual(before);
  });

  /* int64 comes back from protobufjs as a Long whenever the `long` package is
     installed, which it is. A count past 2^31 is where that leaks if the
     decoder forgets to convert, so it is pinned rather than assumed. */
  it('keeps counts exact past the 32-bit boundary', () => {
    const before = [dto({ viewsCount: 4_294_967_296, likesCount: 2_147_483_648 })];
    const after = decodePostList(encodePostList(before));
    expect(after[0].viewsCount).toBe(4_294_967_296);
    expect(after[0].likesCount).toBe(2_147_483_648);
    expect(typeof after[0].viewsCount).toBe('number');
  });

  it('does not round a fractional engagement rate', () => {
    const after = decodePostList(encodePostList([dto({ engagementRate: 8.062949288 })]));
    expect(after[0].engagementRate).toBeCloseTo(8.062949288, 9);
  });

  it('round-trips an empty list', () => {
    expect(decodePostList(encodePostList([]))).toEqual([]);
  });

  it('is smaller than the JSON it replaces', () => {
    const many = Array.from({ length: 200 }, () => dto());
    expect(encodePostList(many).byteLength).toBeLessThan(Buffer.byteLength(JSON.stringify({ posts: many })));
  });
});

describe('wantsProtobuf', () => {
  it('opts in only on an explicit Accept', () => {
    expect(wantsProtobuf(POST_LIST_CONTENT_TYPE)).toBe(true);
    expect(wantsProtobuf('application/x-protobuf, application/json;q=0.9')).toBe(true);
  });

  it('defaults to JSON for every caller that does not ask', () => {
    expect(wantsProtobuf(null)).toBe(false);
    expect(wantsProtobuf(undefined)).toBe(false);
    expect(wantsProtobuf('')).toBe(false);
    expect(wantsProtobuf('application/json')).toBe(false);
    expect(wantsProtobuf('*/*')).toBe(false);
  });
});
