import { createLogger } from "@/lib/observability/logger";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { ensureFreshYouTubeToken } from "@/lib/platforms/youtubeToken";
import { fetchTikTokVideos } from "@/lib/platforms/tiktokDisplay";
import { fetchInstagramAccount, fetchInstagramMedia } from "@/lib/platforms/instagramAccount";
import { fetchYouTubeChannel, fetchYouTubeVideos } from "@/lib/platforms/youtube";
import { fetchFacebookPage, fetchFacebookPagePosts } from "@/lib/platforms/facebookPage";
import { fetchThreadsPosts } from "@/lib/platforms/threads";
import { ensureFreshThreadsToken } from "@/lib/platforms/threadsToken";

/**
 * The creator's own numbers, for one connected platform.
 *
 * `/api/portal/insights` used to be TikTok-only: it queried
 * `platform: "TIKTOK"`, called TikTok's video list, and returned a single
 * flat object. A creator who connected Instagram or YouTube saw nothing, which
 * is also why neither platform had anything to show a reviewer. This module is
 * the platform-agnostic version of that logic; the route below it just maps
 * over the creator's accounts.
 */

/** One recent post, in the shape the portal renders for every platform. */
export type InsightsPost = {
  id: string;
  caption: string | null;
  /** Null when the platform did not measure it — Instagram withholds insights
   *  on media published before the account became a Business/Creator account,
   *  YouTube has no share count — and rendered as an em dash, never as 0. */
  views: number | null;
  likes: number;
  comments: number;
  shares: number;
  postedAt: string;
  shareUrl: string | null;
  coverImageUrl: string | null;
};

export type PlatformInsights = {
  /** Identifies the account, not the platform — a creator can have several on
   *  the same platform, so this is what the UI keys and refreshes on. */
  accountId: string;
  platform: "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "FACEBOOK" | "THREADS";
  connected: true;
  /** The stored token is unusable and cannot be refreshed: the creator has to
   *  authorise again. Distinct from a creator who simply has no posts. */
  needsReconnect: boolean;
  handle: string;
  avatarUrl: string | null;
  /** The creator's own words. Rendered, not just stored: it is the only thing
   *  TikTok's user.info.profile and Instagram's instagram_basic return that a
   *  reviewer can see us display, short of the profile link. */
  bio: string | null;
  profileUrl: string | null;
  isVerified: boolean;
  followers: number | null;
  /** Null where the platform does not publish it — YouTube has no following
   *  count and no lifetime like total — and rendered as an em dash, never 0. */
  following: number | null;
  totalLikes: number | null;
  mediaCount: number | null;
  /** How many posts the figures below were computed from — never the creator's
   *  career total, which is `mediaCount`. */
  sampleSize: number;
  /** Computed over the posts whose views the platform actually measured; null
   *  when it measured none of them, which is not the same as zero views. */
  totalViews: number | null;
  medianViews: number | null;
  bestPost: InsightsPost | null;
  posts: InsightsPost[];
};

/** The account columns this module needs. */
export type InsightsAccount = {
  id: string;
  platform: string;
  handle: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  platformUserId: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileUrl: string | null;
  isVerified: boolean;
  followersCount: number;
  followingCount: number | null;
  totalLikes: number | null;
  mediaCount: number | null;
};

/** A post as any of the three platform modules returns it. */
type NormalisedPost = {
  id: string;
  title?: string;
  description?: string;
  coverImageUrl: string | null;
  shareUrl: string | null;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  /** The uncoerced counters every platform module returns alongside the
   *  display ones; `views` absent here means the platform did not measure it. */
  exact?: { views?: number };
};

/** The measured view count, or null when the platform never reported one. */
function measuredViews(post: NormalisedPost): number | null {
  if (post.exact) return typeof post.exact.views === "number" ? post.exact.views : null;
  return post.viewsCount;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function toInsightsPost(post: NormalisedPost): InsightsPost {
  return {
    id: post.id,
    /* Title first: every platform module derives it from the caption's first
       line where the platform has no title field, and YouTube's title is the
       line a viewer recognises, not the description under it. */
    caption: post.title || post.description || null,
    views: measuredViews(post),
    likes: post.likesCount,
    comments: post.commentsCount,
    shares: post.sharesCount,
    postedAt: post.postedAt,
    shareUrl: post.shareUrl,
    coverImageUrl: post.coverImageUrl,
  };
}

/**
 * Resolves a usable token and the creator's recent posts for one account.
 *
 * `null` posts means the platform call failed, which the caller reports as
 * `needsReconnect`; an empty array means the creator has posted nothing.
 */
async function loadPosts(
  account: InsightsAccount,
  orgId: string,
): Promise<NormalisedPost[] | null> {
  if (account.platform === "TIKTOK") {
    const token = await ensureFreshTikTokToken(account, orgId);
    if (!token) return null;
    return await fetchTikTokVideos(token);
  }

  if (account.platform === "INSTAGRAM") {
    const token = await ensureFreshInstagramToken(account, orgId);
    if (!token) return null;
    /* The IG user id is stored at connect time; resolving it again is the
       fallback for rows written before that column existed. */
    const igUserId =
      account.platformUserId ?? (await fetchInstagramAccount(token))?.igUserId ?? null;
    if (!igUserId) return null;
    return await fetchInstagramMedia(token, igUserId);
  }

  if (account.platform === "FACEBOOK") {
    /* A Meta USER token, with the same long-lived exchange as Instagram's, so
       the Instagram helper is the right one despite the name — it logs under
       INSTAGRAM, which is the one wart. */
    const token = await ensureFreshInstagramToken(account, orgId);
    if (!token) return null;
    /* The Page must be re-resolved on every read, not cached: a Page access
       token is minted from the user token and is what every read below the
       Page requires. Passing the user token to the posts edge returns an empty
       array rather than an error, which reads exactly like a Page that has
       never posted. */
    const page = await fetchFacebookPage(token);
    if (!page) return null;
    return await fetchFacebookPagePosts(page.pageId, page.pageAccessToken);
  }

  if (account.platform === "THREADS") {
    const token = await ensureFreshThreadsToken(account, orgId);
    if (!token) return null;
    return await fetchThreadsPosts(token);
  }

  if (account.platform === "YOUTUBE") {
    const token = await ensureFreshYouTubeToken(account, orgId);
    if (!token) return null;
    /* Unlike the other two, the uploads playlist is not derivable from the
       channel id — YouTube hands it back on the channel call, so this is a
       required round trip rather than a fallback. */
    const channel = await fetchYouTubeChannel(token);
    if (!channel?.uploadsPlaylistId) return null;
    return await fetchYouTubeVideos(token, channel.uploadsPlaylistId);
  }

  return null;
}

function isSupported(
  platform: string,
): platform is PlatformInsights["platform"] {
  return (
    platform === "TIKTOK" ||
    platform === "INSTAGRAM" ||
    platform === "YOUTUBE" ||
    platform === "FACEBOOK" ||
    platform === "THREADS"
  );
}

/** Builds the insights block for one connected account. */
export async function buildPlatformInsights(
  account: InsightsAccount,
  orgId: string,
): Promise<PlatformInsights | null> {
  if (!isSupported(account.platform)) return null;

  const base = {
    accountId: account.id,
    platform: account.platform,
    connected: true as const,
    handle: account.handle,
    avatarUrl: account.avatarUrl,
    bio: account.bio,
    profileUrl: account.profileUrl,
    isVerified: account.isVerified,
    followers: account.followersCount,
    following: account.followingCount,
    totalLikes: account.totalLikes,
    mediaCount: account.mediaCount,
  };

  let posts: NormalisedPost[] | null;
  try {
    posts = await loadPosts(account, orgId);
  } catch (err) {
    /* Instagram's graphGet throws InstagramAuthError on a dead token or a
       withdrawn scope. That is precisely the reconnect case, so it must not
       take the whole response down with it — the creator's other platforms are
       still fine. */
    createLogger({
      context: { platform: account.platform, call: "insights.build" },
    }).warn("Post load failed", {
      accountId: account.id,
      error: err instanceof Error ? err.message : String(err),
    });
    posts = null;
  }

  if (posts === null) {
    return {
      ...base,
      needsReconnect: true,
      sampleSize: 0,
      totalViews: 0,
      medianViews: 0,
      bestPost: null,
      posts: [],
    };
  }

  /* Only measured views count. A post the platform would not report on is
     left out of the total and the median rather than dragging both to zero —
     which is what every Instagram account converted to Business after its
     posts went up looked like: real likes, "0 views" on every row. */
  const views = posts
    .map(measuredViews)
    .filter((v): v is number => typeof v === "number");
  /* Best post by measured views; when none are measured, by likes, so the
     card still leads with the creator's strongest post. */
  const rank = (p: NormalisedPost) =>
    views.length > 0 ? (measuredViews(p) ?? -1) : p.likesCount;
  const best = posts.reduce<NormalisedPost | null>(
    (top, p) => (!top || rank(p) > rank(top) ? p : top),
    null,
  );

  /* `mediaCount` is the career total stored when the creator connected, and
     YouTube's channel statistics lag new uploads by hours — so a creator who
     connected with an empty channel and then uploaded reads "Posts published
     0 · last 2 public posts". The posts just fetched are a measured floor. */
  const mediaCount =
    typeof base.mediaCount === "number"
      ? Math.max(base.mediaCount, posts.length)
      : base.mediaCount;

  return {
    ...base,
    mediaCount,
    needsReconnect: false,
    sampleSize: posts.length,
    totalViews: views.length > 0 ? views.reduce((a, b) => a + b, 0) : null,
    medianViews: views.length > 0 ? Math.round(median(views)) : null,
    bestPost: best ? toInsightsPost(best) : null,
    posts: posts.slice(0, 6).map(toInsightsPost),
  };
}
