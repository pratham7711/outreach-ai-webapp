import type { OAuthPlatform } from "@/lib/oauth/providers";

/**
 * What an agency sees once a creator connects, in plain words, per permission.
 *
 * Each line describes a read the code actually makes with that scope — the
 * consent screen names the permission, this names what it is used for. A
 * permission with no line here is one we would be asking for without saying
 * why, which is the shape of the last App Review rejection; the unit test
 * checks every scope in lib/oauth/providers.ts has one.
 */

export type PermissionLine = { scope: string; reads: string };

export type PlatformReads = {
  /** The button and heading name. */
  label: string;
  lines: PermissionLine[];
};

export const CONNECT_READS: Record<OAuthPlatform, PlatformReads> = {
  instagram: {
    label: "Instagram",
    lines: [
      {
        scope: "instagram_basic",
        reads:
          "Your Instagram username, profile picture, bio, follower and following counts, and your recent posts with their likes and comments.",
      },
      {
        scope: "instagram_manage_insights",
        reads: "Views, reach, shares and saves on your posts.",
      },
      {
        scope: "pages_show_list",
        reads: "Which Facebook Pages you manage — only to find the Instagram account linked to one.",
      },
      {
        scope: "pages_read_engagement",
        reads: "Basic details of that Page, which is how your Instagram account is reached.",
      },
    ],
  },
  "instagram-login": {
    label: "Instagram (no Facebook Page)",
    lines: [
      {
        scope: "instagram_business_basic",
        reads:
          "Your Instagram username, profile picture, bio, follower and following counts, and your recent posts with their likes and comments.",
      },
      {
        scope: "instagram_business_manage_insights",
        reads: "Views, reach and shares on your recent posts.",
      },
    ],
  },
  tiktok: {
    label: "TikTok",
    lines: [
      { scope: "user.info.basic", reads: "Your TikTok username, display name and profile picture." },
      { scope: "user.info.profile", reads: "Your bio, profile link and whether your account is verified." },
      { scope: "user.info.stats", reads: "Your follower, following, likes and video counts." },
      { scope: "video.list", reads: "Your public videos with their views, likes, comments and shares." },
    ],
  },
  youtube: {
    label: "YouTube",
    lines: [
      {
        scope: "https://www.googleapis.com/auth/youtube.readonly",
        reads:
          "Your channel's name, picture, subscriber and video counts, and your public videos with their views, likes and comments.",
      },
    ],
  },
  facebook: {
    label: "Facebook Page",
    lines: [
      { scope: "pages_show_list", reads: "Which Facebook Pages you manage." },
      { scope: "pages_read_engagement", reads: "Your Page's name, picture, followers and likes." },
      { scope: "pages_read_user_content", reads: "Your Page's posts and the comments on them." },
      { scope: "read_insights", reads: "Views on your Page's posts." },
    ],
  },
  threads: {
    label: "Threads",
    lines: [
      { scope: "threads_basic", reads: "Your Threads username, picture, bio and posts." },
      {
        scope: "threads_manage_insights",
        reads: "Views, likes, replies, reposts and quotes on your posts, and your follower count.",
      },
    ],
  },
};

/** What is never done, whatever was connected. Shown under every list. */
export const NEVER_DONE =
  "We never post for you, never read your messages, and never see your password. Disconnect at any time and the stored access is deleted.";
