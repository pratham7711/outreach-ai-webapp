import type { OAuthPlatform } from "@/lib/oauth/providers";

/**
 * "What we read", per permission, in the words the creator sees on My accounts.
 *
 * Every line describes a read the code actually makes, and names the module
 * that makes it, so the sentence and the request can be checked against each
 * other. Platform reviewers compare the two, and a creator deciding whether to
 * connect deserves the same. __tests__/unit/lib/portal/whatWeRead.test.ts
 * fails if a platform requests a scope that has no line here, or a line names
 * a scope nobody requests.
 *
 * Deliberately absent: audience demographics. No connect flow reads them
 * today, so the page must not say it does.
 */

export type PermissionRead = {
  /** The scope string exactly as lib/oauth/providers.ts requests it. */
  scope: string;
  /** What it lets us read, in plain words. */
  reads: string;
};

export const WHAT_WE_READ: Record<OAuthPlatform, PermissionRead[]> = {
  /* Facebook Login for Business, through the Page the account is linked to.
     lib/platforms/instagramAccount.ts (account + media + media insights),
     lib/platforms/instagramAccountInsights.ts (account, follower and story
     insights) and lib/platforms/instagram.ts (insights on posts submitted to a
     campaign). */
  instagram: [
    {
      scope: "instagram_basic",
      reads:
        "Your Instagram username, name, bio, profile picture, follower, following and post counts, and your recent posts: caption, link, image, date, likes and comments.",
    },
    {
      scope: "instagram_manage_insights",
      reads:
        "Views, reach and shares on your recent posts, and reach, views, shares and saves on the posts you submit to a campaign. Your account's insights for the last 28 days (accounts reached, views, engagement, follows and unfollows), your new followers by day, where your followers are and their age and gender, and the insights on stories while they are live.",
    },
    {
      scope: "pages_show_list",
      reads: "The Facebook Pages you manage, so we can find the one your Instagram is linked to.",
    },
    {
      scope: "pages_read_engagement",
      reads: "Which Instagram account is linked to that Page.",
    },
  ],
  /* Instagram Login, for creators without a Facebook Page.
     lib/platforms/instagramLogin.ts. */
  "instagram-login": [
    {
      scope: "instagram_business_basic",
      reads:
        "Your Instagram username, name, bio, profile picture, follower, following and post counts, and your recent posts: caption, link, image, date, likes and comments.",
    },
    {
      scope: "instagram_business_manage_insights",
      reads: "Views, reach and shares on your recent posts.",
    },
  ],
  /* lib/platforms/tiktokDisplay.ts: USER_FIELDS and VIDEO_FIELDS. */
  tiktok: [
    { scope: "user.info.basic", reads: "Your TikTok account ID, display name and profile picture." },
    {
      scope: "user.info.profile",
      reads: "Your username, profile link, bio and whether you are verified.",
    },
    { scope: "user.info.stats", reads: "Your follower, following, total likes and video counts." },
    {
      scope: "video.list",
      reads:
        "Your public videos: each video's ID, title, description, length, cover image, share link, embed link and date posted, and their view, like, comment and share counts.",
    },
  ],
  /* lib/platforms/youtube.ts: channels (snippet, statistics, contentDetails)
     and the uploads playlist with each video's statistics. */
  youtube: [
    {
      scope: "https://www.googleapis.com/auth/youtube.readonly",
      reads:
        "Your channel's name, handle, picture and description, its subscriber, view and video counts, and your recent videos with their title, date, views, likes and comments.",
    },
  ],
  /* lib/platforms/facebookPage.ts: PAGE_FIELDS, POST_FIELDS, the comments
     edge and post_media_view. */
  facebook: [
    {
      scope: "pages_show_list",
      reads: "The Facebook Pages you manage, so you can choose which one we read.",
    },
    {
      scope: "pages_read_engagement",
      reads:
        "Your Page's name, username, link, about text, picture, follower count and verified status, and its recent posts: text, date, link, picture, and like, comment and share counts.",
    },
    {
      scope: "pages_read_user_content",
      reads: "The comments people leave on your Page's posts: the comment, its date, its likes and the commenter's name.",
    },
    { scope: "read_insights", reads: "How many views each of your Page's posts got." },
  ],
  /* lib/platforms/threads.ts: PROFILE_FIELDS, POST_FIELDS, POST_METRICS and
     the followers_count insight. */
  threads: [
    {
      scope: "threads_basic",
      reads: "Your Threads username, name, profile picture and bio, and your recent posts: text, link, media and date.",
    },
    {
      scope: "threads_manage_insights",
      reads: "Views, likes, replies, reposts and quotes on your posts, and your follower count.",
    },
  ],
};

/** The same, for every platform: what connecting never lets us do. */
export const WHAT_WE_NEVER_DO: string[] = [
  "We never post, edit or delete anything on your accounts.",
  "We never read your direct messages or your password.",
  "Disconnect deletes the stored access straight away.",
];
