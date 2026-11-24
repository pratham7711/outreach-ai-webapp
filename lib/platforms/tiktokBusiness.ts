import { createLogger } from "@/lib/observability/logger";
import { tiktokBusinessMock } from "./tiktokBusinessMock";

/**
 * TikTok API for Business, Accounts API (v1.3): the creator authorises our
 * Business developer app for their own TikTok account, and we read that
 * account's profile, daily analytics, audience, post insights and comments, and
 * manage the ad authorization (Spark Ads) code of their own posts.
 *
 * This is a different developer app from Login Kit (lib/platforms/tiktokDisplay.ts):
 * its own client key, its own authorization URL (copied from the developer
 * portal), and a token that is sent in an Access-Token header.
 *
 * Nothing read here feeds discovery, ranking or any comparison across
 * creators. TikTok's terms forbid using authorised accounts' data for a
 * self-built creator discovery program, so these reads are served only to the
 * account's own creator, live, and are not stored.
 */

export const TIKTOK_BUSINESS_API = "https://business-api.tiktok.com/open_api/v1.3";

export const TIKTOK_BUSINESS_SCOPES = [
  "user.info.basic",
  "user.info.username",
  "user.info.profile",
  "user.info.stats",
  "user.account.type",
  "user.insights",
  "video.list",
  "video.insights",
  "comment.list",
  "biz.spark.auth",
] as const;

export const AD_AUTH_DAYS = [7, 30, 60, 180, 365] as const;
export type AdAuthDays = (typeof AD_AUTH_DAYS)[number];

const REQUEST_TIMEOUT_MS = 10_000;

const log = createLogger({ context: { platform: "TIKTOK", call: "business" } });

export class TikTokBusinessAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokBusinessAuthError";
  }
}

export class TikTokBusinessError extends Error {
  constructor(
    public readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "TikTokBusinessError";
  }
}

/** Sample data instead of TikTok, for building and recording locally before
    the developer app is approved. Never in production. */
export function tiktokBusinessMocked(): boolean {
  return process.env.TIKTOK_BUSINESS_MOCK === "1" && process.env.VERCEL_ENV !== "production";
}

export function tiktokBusinessConfigured(): boolean {
  if (tiktokBusinessMocked()) return true;
  return Boolean(process.env.TIKTOK_BUSINESS_APP_ID && process.env.TIKTOK_BUSINESS_SECRET && process.env.TIKTOK_BUSINESS_AUTH_URL);
}

/** The TikTok account holder authorization URL from the developer portal, with
    our CSRF state and auto-approval turned off so the creator always sees the
    permission screen. */
export function tiktokBusinessAuthorizeUrl(state: string): string | null {
  const base = process.env.TIKTOK_BUSINESS_AUTH_URL;
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set("state", state);
  url.searchParams.set("disable_auto_auth", "1");
  return url.toString();
}

/* TikTok answers HTTP 200 with a body code. 0 is success; these mean the
   token is no longer good. */
const AUTH_CODES = new Set([40001, 40100, 40102, 40104, 40105]);

type Envelope<T> = { code: number; message: string; request_id?: string; data?: T };

async function call<T>(method: "GET" | "POST", path: string, token: string | null, params: Record<string, unknown>): Promise<T> {
  const url = new URL(`${TIKTOK_BUSINESS_API}${path}`);
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (token) (init.headers as Record<string, string>)["Access-Token"] = token;
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
  } else {
    init.body = JSON.stringify(params);
  }

  const res = await fetch(url, init);
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // a non-JSON body is reported below by status alone
  }
  if (!res.ok || !body || body.code !== 0) {
    const code = body?.code ?? null;
    log.warn("TikTok Business request failed", { path, status: res.status, code, message: body?.message });
    if (res.status === 401 || (code !== null && AUTH_CODES.has(code))) throw new TikTokBusinessAuthError(body?.message ?? "unauthorized");
    throw new TikTokBusinessError(code, body?.message ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}

/* ---------- tokens ---------- */

export type TikTokBusinessTokens = {
  accessToken: string;
  refreshToken: string;
  openId: string;
  scope: string[];
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

type TokenData = {
  access_token: string;
  refresh_token: string;
  open_id: string;
  scope: string;
  expires_in: number;
  refresh_token_expires_in: number;
};

function tokensFrom(d: TokenData, now = Date.now()): TikTokBusinessTokens {
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    openId: d.open_id,
    scope: (d.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    accessExpiresAt: new Date(now + (d.expires_in ?? 86_400) * 1000),
    refreshExpiresAt: new Date(now + (d.refresh_token_expires_in ?? 31_536_000) * 1000),
  };
}

export async function exchangeTikTokBusinessCode(authCode: string, redirectUri: string): Promise<TikTokBusinessTokens> {
  if (tiktokBusinessMocked()) return tokensFrom(tiktokBusinessMock.token());
  const data = await call<TokenData>("POST", "/tt_user/oauth2/token/", null, {
    client_id: process.env.TIKTOK_BUSINESS_APP_ID,
    client_secret: process.env.TIKTOK_BUSINESS_SECRET,
    grant_type: "authorization_code",
    auth_code: authCode,
    redirect_uri: redirectUri,
  });
  return tokensFrom(data);
}

export async function refreshTikTokBusinessToken(refreshToken: string): Promise<TikTokBusinessTokens> {
  if (tiktokBusinessMocked()) return tokensFrom(tiktokBusinessMock.token());
  const data = await call<TokenData>("POST", "/tt_user/oauth2/refresh_token/", null, {
    client_id: process.env.TIKTOK_BUSINESS_APP_ID,
    client_secret: process.env.TIKTOK_BUSINESS_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return tokensFrom(data);
}

export async function revokeTikTokBusinessToken(accessToken: string): Promise<void> {
  if (tiktokBusinessMocked()) return;
  await call("POST", "/tt_user/oauth2/revoke/", null, {
    client_id: process.env.TIKTOK_BUSINESS_APP_ID,
    client_secret: process.env.TIKTOK_BUSINESS_SECRET,
    access_token: accessToken,
  });
}

/* ---------- profile, account type, daily analytics, audience ---------- */

export type Share = { key: string; share: number };
export type DailyMetrics = {
  date: string;
  videoViews: number | null;
  profileViews: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  followers: number | null;
  newFollowers: number | null;
  lostFollowers: number | null;
};

export type TikTokBusinessProfile = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileUrl: string | null;
  isVerified: boolean;
  /** "business": a Verified Business Account; "advanced": linked to TikTok
      for Business; "personal": neither. Some analytics come only with the
      first two. */
  accountType: "business" | "advanced" | "personal";
  followers: number | null;
  following: number | null;
  totalLikes: number | null;
  videos: number | null;
  daily: DailyMetrics[];
  audience: { ages: Share[]; genders: Share[]; countries: Share[] };
};

const PROFILE_FIELDS = [
  "is_business_account",
  "has_advanced_access",
  "username",
  "display_name",
  "profile_image",
  "bio_description",
  "profile_deep_link",
  "is_verified",
  "followers_count",
  "following_count",
  "total_likes",
  "videos_count",
  "video_views",
  "profile_views",
  "likes",
  "comments",
  "shares",
  "daily_new_followers",
  "daily_lost_followers",
  "audience_ages",
  "audience_genders",
  "audience_countries",
];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** TikTok's `percentage` reads as 0-1 in some answers and 0-100 in others;
    every share here is 0-1. */
export function normaliseShares(rows: unknown, key: string): Share[] {
  if (!Array.isArray(rows)) return [];
  const raw = rows
    .map((r) => ({ key: String((r as Record<string, unknown>)?.[key] ?? ""), value: num((r as Record<string, unknown>)?.percentage) }))
    .filter((r): r is { key: string; value: number } => Boolean(r.key) && r.value !== null && r.value >= 0);
  const total = raw.reduce((s, r) => s + r.value, 0);
  const scale = total > 1.5 ? 100 : 1;
  return raw.map((r) => ({ key: r.key, share: r.value / scale })).sort((a, b) => b.share - a.share);
}

export function parseRetention(rows: unknown): Array<{ second: number; share: number }> {
  if (!Array.isArray(rows)) return [];
  const raw = rows
    .map((r) => ({ second: Number((r as Record<string, unknown>)?.second), value: num((r as Record<string, unknown>)?.percentage) }))
    .filter((r): r is { second: number; value: number } => Number.isFinite(r.second) && r.value !== null && r.value >= 0);
  const scale = raw.some((r) => r.value > 1.5) ? 100 : 1;
  return raw.map((r) => ({ second: r.second, share: Math.min(1, r.value / scale) })).sort((a, b) => a.second - b.second);
}

export function parseProfile(d: Record<string, unknown>): TikTokBusinessProfile {
  const metrics = Array.isArray(d.metrics) ? (d.metrics as Record<string, unknown>[]) : [];
  return {
    username: str(d.username) ?? "",
    displayName: str(d.display_name),
    avatarUrl: str(d.profile_image),
    bio: str(d.bio_description),
    profileUrl: str(d.profile_deep_link),
    isVerified: d.is_verified === true,
    accountType: d.is_business_account === true ? "business" : d.has_advanced_access === true ? "advanced" : "personal",
    followers: num(d.followers_count),
    following: num(d.following_count),
    totalLikes: num(d.total_likes),
    videos: num(d.videos_count),
    daily: metrics
      .map((m) => ({
        date: String(m.date ?? ""),
        videoViews: num(m.video_views),
        profileViews: num(m.profile_views),
        likes: num(m.likes),
        comments: num(m.comments),
        shares: num(m.shares),
        followers: num(m.followers_count),
        newFollowers: num(m.daily_new_followers),
        lostFollowers: num(m.daily_lost_followers),
      }))
      .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date))
      .sort((a, b) => a.date.localeCompare(b.date)),
    audience: {
      ages: normaliseShares(d.audience_ages, "age"),
      genders: normaliseShares(d.audience_genders, "gender"),
      countries: normaliseShares(d.audience_countries, "country"),
    },
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function fetchTikTokBusinessProfile(token: string, businessId: string, days: number, now = new Date()): Promise<TikTokBusinessProfile> {
  /* Data lands T+24-48h and the look-back is capped at 60 days. */
  const end = new Date(now.getTime() - 86_400_000);
  const start = new Date(end.getTime() - (Math.min(Math.max(days, 7), 60) - 1) * 86_400_000);
  if (tiktokBusinessMocked()) return parseProfile(tiktokBusinessMock.profile(isoDay(start), isoDay(end)));
  const data = await call<Record<string, unknown>>("GET", "/business/get/", token, {
    business_id: businessId,
    start_date: isoDay(start),
    end_date: isoDay(end),
    fields: PROFILE_FIELDS,
  });
  return parseProfile(data ?? {});
}

/* ---------- posts with insights ---------- */

export type TikTokBusinessPost = {
  id: string;
  caption: string | null;
  thumbnailUrl: string | null;
  shareUrl: string | null;
  postedAt: string | null;
  mediaType: "VIDEO" | "PHOTO";
  isAd: boolean;
  durationSeconds: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  reach: number | null;
  totalWatchSeconds: number | null;
  averageWatchSeconds: number | null;
  fullWatchRate: number | null;
  newFollowers: number | null;
  retention: Array<{ second: number; share: number }>;
  sources: Share[];
  audience: { genders: Share[]; countries: Share[] };
};

const POST_FIELDS = [
  "item_id",
  "media_type",
  "is_ad",
  "thumbnail_url",
  "share_url",
  "caption",
  "create_time",
  "video_duration",
  "video_views",
  "likes",
  "comments",
  "shares",
  "reach",
  "total_time_watched",
  "average_time_watched",
  "full_video_watched_rate",
  "new_followers",
  "video_view_retention",
  "impression_sources",
  "audience_genders",
  "audience_countries",
];

export function parsePost(v: Record<string, unknown>): TikTokBusinessPost {
  const created = num(Number(v.create_time));
  const rate = num(v.full_video_watched_rate);
  return {
    id: String(v.item_id ?? ""),
    caption: str(v.caption),
    thumbnailUrl: str(v.thumbnail_url),
    shareUrl: str(v.share_url),
    postedAt: created ? new Date(created * 1000).toISOString() : null,
    mediaType: v.media_type === "PHOTO" ? "PHOTO" : "VIDEO",
    isAd: v.is_ad === true,
    durationSeconds: num(v.video_duration),
    views: num(v.video_views),
    likes: num(v.likes),
    comments: num(v.comments),
    shares: num(v.shares),
    reach: num(v.reach),
    totalWatchSeconds: num(v.total_time_watched),
    averageWatchSeconds: num(v.average_time_watched),
    fullWatchRate: rate === null ? null : rate > 1 ? rate / 100 : rate,
    newFollowers: num(v.new_followers),
    retention: parseRetention(v.video_view_retention),
    sources: normaliseShares(v.impression_sources, "impression_source"),
    audience: {
      genders: normaliseShares(v.audience_genders, "gender"),
      countries: normaliseShares(v.audience_countries, "country"),
    },
  };
}

export async function fetchTikTokBusinessPosts(token: string, businessId: string, maxCount = 12): Promise<TikTokBusinessPost[]> {
  if (tiktokBusinessMocked()) return tiktokBusinessMock.posts().map(parsePost);
  const data = await call<{ videos?: Record<string, unknown>[] }>("GET", "/business/video/list/", token, {
    business_id: businessId,
    fields: POST_FIELDS,
    max_count: Math.min(Math.max(maxCount, 1), 20),
  });
  return (data?.videos ?? []).map(parsePost).filter((p) => p.id);
}

/* ---------- comments ---------- */

export type TikTokBusinessComment = {
  id: string;
  text: string;
  username: string | null;
  likes: number;
  replies: number;
  createdAt: string | null;
  byOwner: boolean;
  pinned: boolean;
  hidden: boolean;
};

export function parseComment(c: Record<string, unknown>): TikTokBusinessComment {
  const created = num(Number(c.create_time));
  return {
    id: String(c.comment_id ?? ""),
    text: typeof c.text === "string" ? c.text : "",
    username: str(c.username),
    likes: num(c.likes) ?? 0,
    replies: num(c.replies) ?? 0,
    createdAt: created ? new Date(created * 1000).toISOString() : null,
    byOwner: c.owner === true,
    pinned: c.pinned === true,
    hidden: c.status === "HIDDEN",
  };
}

export async function fetchTikTokBusinessComments(token: string, businessId: string, videoId: string): Promise<TikTokBusinessComment[]> {
  if (tiktokBusinessMocked()) return tiktokBusinessMock.comments(videoId).map(parseComment);
  const data = await call<{ comments?: Record<string, unknown>[] }>("GET", "/business/comment/list/", token, {
    business_id: businessId,
    video_id: videoId,
    sort_field: "likes",
    sort_order: "desc",
    max_count: 30,
  });
  return (data?.comments ?? []).map(parseComment).filter((c) => c.id);
}

export async function fetchTikTokBusinessReplies(token: string, businessId: string, videoId: string, commentId: string): Promise<TikTokBusinessComment[]> {
  if (tiktokBusinessMocked()) return tiktokBusinessMock.replies(commentId).map(parseComment);
  const data = await call<{ comments?: Record<string, unknown>[] }>("GET", "/business/comment/reply/list/", token, {
    business_id: businessId,
    video_id: videoId,
    comment_id: commentId,
    max_count: 30,
  });
  return (data?.comments ?? []).map(parseComment).filter((c) => c.id);
}

/* ---------- ad authorization (Spark Ads code) ---------- */

export type AdAuthorization =
  | { enabled: false }
  | {
      enabled: true;
      code: string;
      startsAt: string | null;
      endsAt: string | null;
      days: number | null;
      status: "NOT_USED" | "IN_USE" | "EXPIRED" | "UNKNOWN";
    };

/** TikTok gives times as "YYYY-MM-DD HH:MM:SS" in UTC. */
function utcTime(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return null;
  return `${v.replace(" ", "T")}Z`;
}

export function parseAdAuthorization(d: Record<string, unknown> | null | undefined): AdAuthorization {
  const code = str(d?.auth_code);
  if (!d || !code) return { enabled: false };
  const status = d.auth_code_status;
  return {
    enabled: true,
    code,
    startsAt: utcTime(d.auth_code_start_time),
    endsAt: utcTime(d.auth_code_end_time),
    days: num(d.authorization_days),
    status: status === "NOT_USED" || status === "IN_USE" || status === "EXPIRED" ? status : "UNKNOWN",
  };
}

export async function fetchAdAuthorization(token: string, businessId: string, itemId: string): Promise<AdAuthorization> {
  if (tiktokBusinessMocked()) return parseAdAuthorization(tiktokBusinessMock.adStatus(itemId));
  try {
    const data = await call<Record<string, unknown>>("GET", "/business/post/authorize/status/", token, { business_id: businessId, item_id: itemId });
    return parseAdAuthorization(data);
  } catch (e) {
    /* A post that was never authorised answers with an error code rather
       than an empty object. */
    if (e instanceof TikTokBusinessError) return { enabled: false };
    throw e;
  }
}

export async function enableAdAuthorization(token: string, businessId: string, itemId: string, days: AdAuthDays): Promise<AdAuthorization> {
  if (tiktokBusinessMocked()) return parseAdAuthorization(tiktokBusinessMock.enable(itemId, days));
  const data = await call<Record<string, unknown>>("POST", "/business/post/authorize/setting/", token, {
    business_id: businessId,
    item_id: itemId,
    is_ad_promotable: true,
    authorization_days: days,
  });
  return parseAdAuthorization({ ...data, auth_code_status: "NOT_USED" });
}

export async function extendAdAuthorization(token: string, businessId: string, itemId: string, days: AdAuthDays): Promise<AdAuthorization> {
  if (tiktokBusinessMocked()) return parseAdAuthorization(tiktokBusinessMock.extend(itemId, days));
  await call("POST", "/business/post/authorize/", token, { business_id: businessId, item_id: itemId, authorization_days: days });
  return fetchAdAuthorization(token, businessId, itemId);
}

export async function deleteAdAuthorization(token: string, businessId: string, itemId: string): Promise<void> {
  if (tiktokBusinessMocked()) return tiktokBusinessMock.remove(itemId);
  await call("POST", "/business/post/authorize/delete/", token, { business_id: businessId, item_id: itemId });
}
