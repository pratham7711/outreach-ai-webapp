import { BRAND } from "@/lib/brand";

export const OAUTH_PLATFORMS = [
  "instagram",
  /* The SECOND Instagram path, not a replacement for the first.
     "instagram" is Facebook Login for Business: it reaches the IG account
     through the Facebook Page it is linked to, which is the only way to get
     business_discovery (public numbers for creators who have NOT authorised
     us). "instagram-login" is Instagram Login: the creator authorises
     Instagram directly, no Facebook Page required.
     Both are needed. The Page requirement excludes every creator with a
     professional account and no Page — and instagram_business_basic was in the
     Meta submission with no flow behind it, which is why its testing counter
     never moved. */
  "instagram-login",
  "tiktok",
  "youtube",
  "facebook",
  "threads",
] as const;

export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];

export type PlatformEnumValue =
  | "INSTAGRAM"
  | "TIKTOK"
  | "YOUTUBE"
  | "FACEBOOK"
  | "THREADS";

type ProviderConfig = {
  platformEnum: PlatformEnumValue;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Tried when the platform's own pair is unset. Only Facebook uses this: it
   *  is the same Meta app as Instagram, so prod already holds its credentials
   *  under the Instagram names and nothing new has to be minted or copied. */
  fallbackClientIdEnv?: string;
  fallbackClientSecretEnv?: string;
  /** A sandbox pair that REPLACES the platform's own pair while the flag env
   *  reads "1" or "true". Only TikTok uses this: an unapproved TikTok app can
   *  only complete OAuth for its sandbox's target users, so the review demo
   *  has to run against the sandbox client key on the production domain. The
   *  production pair is marked sensitive in Vercel and cannot be read back, so
   *  the switch is a separate set of variables rather than an overwrite. */
  sandboxFlagEnv?: string;
  sandboxClientIdEnv?: string;
  sandboxClientSecretEnv?: string;
  clientIdParam: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeSeparator: string;
};

const PROVIDERS: Record<OAuthPlatform, ProviderConfig> = {
  instagram: {
    platformEnum: "INSTAGRAM",
    clientIdEnv: "INSTAGRAM_CLIENT_ID",
    clientSecretEnv: "INSTAGRAM_CLIENT_SECRET",
    clientIdParam: "client_id",
    authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v26.0/oauth/access_token",
    /* pages_show_list is not optional, and its absence is why the creator-token
       Graph path has almost certainly never returned a number.
       resolveIgUserId (lib/platforms/instagram.ts) reads
       `me/accounts?fields=instagram_business_account{id}` -- the PAGES edge --
       because an IG Business account is reachable only through the Facebook
       Page it is linked to. instagram_basic grants the IG object once you hold
       its id; it does not grant the listing that yields the id. Without
       pages_show_list that call returns an empty data array for every token
       this app has ever minted, resolveIgUserId returns null, and the fetch
       falls through to the Business Discovery path or to nothing.

       instagram_manage_insights stays: it is what /insights (the views metric)
       needs, and views is the counter Instagram will not put on the media
       object itself.

       pages_read_engagement is the same class of omission as pages_show_list
       was. Meta's reference for the business_discovery edge names exactly three
       required permissions -- instagram_basic, instagram_manage_insights and
       pages_read_engagement -- and lists it again in the permission set for
       "Instagram API with Facebook Login". pages_show_list yields the Page
       *listing*; reading the content and metadata hanging off that Page is what
       pages_read_engagement grants, so without it the media walk is entitled to
       the id and nothing behind it.
       Source: developers.facebook.com/docs/instagram-platform/instagram-graph-api
       /reference/ig-user/business_discovery (read 2026-09-04).

       NOTE on access level: a permission the app holds at Standard Access is
       granted only to users with a role on the app (admin/developer/tester).
       For a creator with no such role it comes back declined, which is why the
       four below need Advanced Access -- App Review + Business Verification --
       before the connect funnel works for a real tenant. Adding a scope here
       does not itself grant it. */
    scopes: [
      "instagram_basic",
      "instagram_manage_insights",
      "pages_show_list",
      "pages_read_engagement",
    ],
    scopeSeparator: ",",
  },
  "instagram-login": {
    platformEnum: "INSTAGRAM",
    /* A DIFFERENT app id from INSTAGRAM_CLIENT_ID. Instagram Login authorises
       against the Instagram app inside the Meta app — its own id and secret,
       shown in the dashboard as "Instagram app ID" — and passing the Facebook
       app id here returns an invalid_client_id from instagram.com. No fallback
       to the Instagram/Facebook pair for exactly that reason: a wrong id that
       silently half-works is worse than a connect button that stays absent
       until the right credential is set. */
    clientIdEnv: "INSTAGRAM_LOGIN_CLIENT_ID",
    clientSecretEnv: "INSTAGRAM_LOGIN_CLIENT_SECRET",
    clientIdParam: "client_id",
    /* instagram.com, not facebook.com: this dialog does not involve a Page,
       and the token it mints is read at graph.instagram.com. */
    authorizeUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    /* instagram_business_basic yields the profile and the media list;
       instagram_business_manage_insights yields per-media views/reach/shares —
       the same counters instagram_manage_insights gives on the Page path, under
       the names the Instagram-Login API uses.
       Deliberately NOT requested: instagram_business_manage_comments and
       instagram_business_content_publish. Neither has a screen, and a scope
       with no screen is what sank the last submission. */
    scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
    scopeSeparator: ",",
  },
  tiktok: {
    platformEnum: "TIKTOK",
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    sandboxFlagEnv: "TIKTOK_USE_SANDBOX",
    sandboxClientIdEnv: "TIKTOK_SANDBOX_CLIENT_KEY",
    sandboxClientSecretEnv: "TIKTOK_SANDBOX_CLIENT_SECRET",
    clientIdParam: "client_key",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    /* These four are not aspirational -- lib/platforms/tiktokDisplay.ts already
       asks /v2/user/info/ for eleven fields, and only four of them
       (open_id, username, display_name, avatar_url) are covered by
       user.info.basic. bio_description, profile_deep_link and is_verified need
       user.info.profile; follower_count, following_count, likes_count and
       video_count need user.info.stats. Requesting the narrower scope set and
       the wider field set meant seven fields could only ever come back empty.

       They are also exactly the scopes the developer-portal app declares, and
       TikTok's review requires the two to agree: unused scopes must be removed
       before review, and every declared scope must be demonstrated. */
    scopes: [
      "user.info.basic",
      "user.info.profile",
      "user.info.stats",
      "video.list",
    ],
    scopeSeparator: ",",
  },
  youtube: {
    platformEnum: "YOUTUBE",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    clientIdParam: "client_id",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    scopeSeparator: " ",
  },
  facebook: {
    platformEnum: "FACEBOOK",
    /* Normally the SAME Meta app as Instagram, so these two variables usually
       carry the same values as INSTAGRAM_CLIENT_ID/SECRET. They are named
       separately anyway: isProviderConfigured gates each platform on its own
       pair, so sharing one name would make it impossible to ship Instagram
       without also opening the Facebook connect button. */
    clientIdEnv: "FACEBOOK_CLIENT_ID",
    clientSecretEnv: "FACEBOOK_CLIENT_SECRET",
    /* Same Meta app, so the Instagram pair is a correct credential for it. The
       Facebook names still win when set, which keeps the two independently
       switchable; the fallback only means Facebook is not stuck behind a copy
       of a secret that cannot be read back out of Vercel. */
    fallbackClientIdEnv: "INSTAGRAM_CLIENT_ID",
    fallbackClientSecretEnv: "INSTAGRAM_CLIENT_SECRET",
    clientIdParam: "client_id",
    authorizeUrl: "https://www.facebook.com/v26.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v26.0/oauth/access_token",
    /* pages_show_list yields the Page listing and the per-Page access token —
       without it there is no Page id to read anything from.
       pages_read_engagement grants the Page's own fields (about, fan_count,
       followers_count, picture, verification_status).
       pages_read_user_content grants the /posts edge and its message text.
       read_insights grants post_impressions, which is the only view count
       Facebook does not hang off the post object itself.
       All four are Advanced Access permissions: at Standard Access they are
       granted only to users holding a role on the app. */
    scopes: [
      "pages_show_list",
      "pages_read_engagement",
      "pages_read_user_content",
      "read_insights",
    ],
    scopeSeparator: ",",
  },
  threads: {
    platformEnum: "THREADS",
    /* Threads is a separate app id inside the Meta app, not the Instagram one,
       and it authorises on threads.net rather than facebook.com. */
    clientIdEnv: "THREADS_CLIENT_ID",
    clientSecretEnv: "THREADS_CLIENT_SECRET",
    clientIdParam: "client_id",
    authorizeUrl: "https://threads.net/oauth/authorize",
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    /* threads_basic covers identity and the post list. threads_manage_insights
       covers per-post views/likes/replies/reposts/quotes AND the account's
       follower count, which Threads publishes only through the insights edge —
       there is no followers field on the profile object. */
    scopes: ["threads_basic", "threads_manage_insights"],
    scopeSeparator: ",",
  },
};

export function isOAuthPlatform(value: string): value is OAuthPlatform {
  return (OAUTH_PLATFORMS as readonly string[]).includes(value);
}

export function toPlatformEnum(platform: OAuthPlatform): PlatformEnumValue {
  return PROVIDERS[platform].platformEnum;
}

function appBaseUrl(): string {
  const base =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === "production" ? BRAND.url : "http://localhost:3009");
  return base.replace(/\/+$/, "");
}

export function redirectUri(platform: OAuthPlatform): string {
  return `${appBaseUrl()}/api/portal/connections/${platform}/callback`;
}

function flagOn(name: string | undefined): boolean {
  if (!name) return false;
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** The id/secret pair for a platform, honouring its sandbox and fallback names. */
function credentials(
  provider: ProviderConfig,
): { clientId: string; clientSecret: string } | null {
  /* The sandbox pair wins only while the flag is on AND both halves are set.
     A flag with no pair behind it falls through to the normal resolution, so
     forgetting to stage the keys degrades to the production app rather than
     to a platform that silently cannot connect. */
  if (flagOn(provider.sandboxFlagEnv)) {
    const sbId = provider.sandboxClientIdEnv && process.env[provider.sandboxClientIdEnv];
    const sbSecret =
      provider.sandboxClientSecretEnv && process.env[provider.sandboxClientSecretEnv];
    if (sbId && sbSecret) return { clientId: sbId, clientSecret: sbSecret };
  }

  const ownId = process.env[provider.clientIdEnv];
  const ownSecret = process.env[provider.clientSecretEnv];
  if (ownId && ownSecret) return { clientId: ownId, clientSecret: ownSecret };

  /* Both halves must come from the same pair. Mixing FACEBOOK_CLIENT_ID with
     INSTAGRAM_CLIENT_SECRET would only ever be right by coincidence. */
  const fbId = provider.fallbackClientIdEnv && process.env[provider.fallbackClientIdEnv];
  const fbSecret =
    provider.fallbackClientSecretEnv && process.env[provider.fallbackClientSecretEnv];
  if (fbId && fbSecret) return { clientId: fbId, clientSecret: fbSecret };
  return null;
}

export function isProviderConfigured(platform: OAuthPlatform): boolean {
  return credentials(PROVIDERS[platform]) !== null;
}

/**
 * The full id/secret pair a platform is currently running under.
 *
 * Token refresh and revoke must present the same client the token was minted
 * for; reading TIKTOK_CLIENT_KEY directly would pair a sandbox token with the
 * production key the moment TIKTOK_USE_SANDBOX is on.
 */
export function clientCredentialsFor(
  platform: OAuthPlatform,
): { clientId: string; clientSecret: string } | null {
  return credentials(PROVIDERS[platform]);
}

/**
 * The app secret a platform's webhooks are signed with.
 *
 * Meta signs its deauthorize and data-deletion callbacks with the app secret,
 * so the webhook handler needs the same resolution the token exchange uses —
 * including the Facebook→Instagram fallback — or a shared app would verify for
 * one platform and not the other.
 */
export function clientSecretFor(platform: OAuthPlatform): string | null {
  return credentials(PROVIDERS[platform])?.clientSecret ?? null;
}

/**
 * TIKTOK_SCOPES may narrow the requested scopes; it may never widen them.
 *
 * TikTok's review fails an app that asks for a scope its portal entry does not
 * declare, and the override used to be passed through verbatim -- so a stray
 * value in one environment variable could sink a submission while every scope
 * in the code stayed correct. The variable is marked sensitive in production
 * and reads back as [SENSITIVE], so its value cannot be audited from a laptop;
 * the only safe assumption is that it might be wrong.
 *
 * Intersecting keeps the reason the override exists -- asking for less while
 * testing a narrower grant -- and makes the failure mode impossible, without
 * anyone needing to read the secret. An override naming nothing declared is
 * ignored rather than obeyed: requesting no scopes at all is not a safer
 * outcome than requesting the declared set.
 */
function resolveScopes(
  platform: OAuthPlatform,
  provider: ProviderConfig,
): string {
  const raw =
    platform === "tiktok" ? process.env.TIKTOK_SCOPES?.trim() : undefined;
  if (!raw) return provider.scopes.join(provider.scopeSeparator);

  const declared = new Set(provider.scopes);
  const kept = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && declared.has(s));

  if (kept.length === 0) return provider.scopes.join(provider.scopeSeparator);
  return kept.join(provider.scopeSeparator);
}

export function buildAuthorizeUrl(
  platform: OAuthPlatform,
  state: string,
): string | null {
  const provider = PROVIDERS[platform];
  const creds = credentials(provider);
  if (!creds) return null;
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set(provider.clientIdParam, creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri(platform));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", resolveScopes(platform, provider));
  url.searchParams.set("state", state);
  if (platform === "tiktok") url.searchParams.set("disable_auto_auth", "1");
  if (platform === "youtube") {
    /* Google only issues a refresh token when offline access is requested.
       Without it every YouTube connection died exactly 60 minutes after
       consent (measured on prod 2026-09-07: tokenExpiry = connect + 1h, no
       refresh row). prompt=consent makes Google re-issue the refresh token on
       a re-authorisation instead of silently omitting it. */
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return url.toString();
}

export function buildTokenRequest(
  platform: OAuthPlatform,
  code: string,
): { url: string; body: URLSearchParams } | null {
  const provider = PROVIDERS[platform];
  const creds = credentials(provider);
  if (!creds) return null;
  const body = new URLSearchParams({
    [provider.clientIdParam]: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(platform),
  });
  return { url: provider.tokenUrl, body };
}
