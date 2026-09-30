/**
 * A creator's Avg. Views: the mean views of their 10 newest posts.
 *
 * One definition for every platform, because the tracker compares creators
 * across platforms and a mean over "whatever the reader happened to see" is a
 * different statistic per reader: Instagram's covered up to 100 reels, YouTube's
 * 20 uploads, TikTok's the whole grid with pinned videos on top of it.
 *
 * Pinned posts are left out. They sit at the head of a TikTok grid, they are
 * usually an old hit, and they say nothing about what the creator's next post
 * will do. CreatorCore leaves them out too -- measured 2026-10-01 from the
 * denominators of its stored averages: a creator with 1 pinned video is
 * averaged over 9 posts, one with 3 pinned over 7. It does not top the ten
 * back up with older posts; we do, so a creator with pins is still averaged
 * over ten.
 *
 * A post without a view count is skipped rather than counted as zero:
 * Instagram sends no view_count on stills, and averaging those in as zeros is
 * how a reel-heavy creator gets reported as having no views.
 */

export const RECENT_POSTS_FOR_AVERAGE = 10;

export type ViewedPost = {
  views: number | null | undefined;
  /** ISO string or Date; posts without one keep their place after the dated. */
  postedAt: string | Date | null | undefined;
  pinned?: boolean;
};

export type RecentViews = {
  avgViews: number;
  /** How many posts the mean was taken over -- 0 means avgViews is not a measurement. */
  sampledPosts: number;
};

function timeOf(value: ViewedPost["postedAt"]): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function latestAverageViews(
  posts: readonly ViewedPost[],
  count: number = RECENT_POSTS_FOR_AVERAGE
): RecentViews {
  const eligible = posts
    .map((post, index) => ({ post, index, t: timeOf(post.postedAt) }))
    .filter(({ post }) => !post.pinned && typeof post.views === "number" && Number.isFinite(post.views));

  /* Newest first by date; undated posts keep the reader's own order after the
     dated ones, since every reader lists newest first anyway. */
  eligible.sort((a, b) => {
    if (a.t !== null && b.t !== null) return b.t - a.t || a.index - b.index;
    if (a.t !== null) return -1;
    if (b.t !== null) return 1;
    return a.index - b.index;
  });

  const views = eligible.slice(0, count).map(({ post }) => post.views as number);
  if (views.length === 0) return { avgViews: 0, sampledPosts: 0 };
  return { avgViews: views.reduce((a, b) => a + b, 0) / views.length, sampledPosts: views.length };
}

/* TikTok launched internationally in 2017; an id decoding to earlier than this
   is a fixture or a malformed value, not a post date. */
const EARLIEST_TIKTOK_POST_MS = Date.UTC(2016, 0, 1);

/**
 * When a TikTok post was published, from its id alone.
 *
 * The top 32 bits of a TikTok video id are its creation time in Unix seconds.
 * The embed page carries no dates at all, so this is the only way it can say
 * which of its videos are newest. Checked 2026-10-01 against 300 TikTok posts
 * whose dates we store: 281 decode to within a minute of the stored date
 * (median 8 seconds); in the other 19 the stored date is later, by up to 7.5
 * hours. Close enough to order posts by, which is all this is used for.
 */
export function tiktokPostedAtFromId(id: string, now: Date = new Date()): string | null {
  if (!/^\d{15,20}$/.test(id)) return null;
  const ms = Number(BigInt(id) >> BigInt(32)) * 1000;
  if (ms < EARLIEST_TIKTOK_POST_MS || ms > now.getTime() + 24 * 60 * 60 * 1000) return null;
  return new Date(ms).toISOString();
}

/** TikTok lets a creator pin at most three videos. */
const MAX_TIKTOK_PINS = 3;

/**
 * Which videos in a TikTok grid are pinned, when the source does not say.
 *
 * The grid lists pinned videos first and then everything else newest first, so
 * the pinned ones are whatever sits ahead of the newest video. A pinned video
 * that is itself the newest is indistinguishable from an unpinned one; it is
 * also the most recent post, so counting it is correct either way.
 */
export function pinnedByGridOrder(posts: readonly { postedAt: string | null }[]): boolean[] {
  const times = posts.map((p) => timeOf(p.postedAt));
  let newest = -1;
  times.forEach((t, i) => {
    if (t !== null && (newest < 0 || t > (times[newest] as number))) newest = i;
  });
  if (newest <= 0 || newest > MAX_TIKTOK_PINS) return posts.map(() => false);
  return posts.map((_, i) => i < newest);
}

/**
 * When readings started meaning "the ten newest posts".
 *
 * Snapshots before this averaged whatever the reader saw -- up to 100 reels, 20
 * uploads, a whole TikTok grid with its pins -- so comparing one of them with a
 * newer reading would report a change that is only the definition moving.
 * Changes and the views chart start here; the headline figure is simply the
 * latest reading, which is the new definition as soon as a creator is re-read.
 */
export const LATEST_TEN_SINCE = new Date("2026-10-02T00:00:00Z");
