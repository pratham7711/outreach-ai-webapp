import { BRAND } from "@/lib/brand";

export const OAUTH_PLATFORMS = ["instagram", "tiktok", "youtube"] as const;

export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];

export type PlatformEnumValue = "INSTAGRAM" | "TIKTOK" | "YOUTUBE";

type ProviderConfig = {
  platformEnum: PlatformEnumValue;
  clientIdEnv: string;
  clientSecretEnv: string;
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
       object itself. */
    scopes: ["instagram_basic", "instagram_manage_insights", "pages_show_list"],
    scopeSeparator: ",",
  },
  tiktok: {
    platformEnum: "TIKTOK",
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
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

export function isProviderConfigured(platform: OAuthPlatform): boolean {
  const provider = PROVIDERS[platform];
  return Boolean(
    process.env[provider.clientIdEnv] && process.env[provider.clientSecretEnv],
  );
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
  const clientId = process.env[provider.clientIdEnv];
  if (!clientId || !process.env[provider.clientSecretEnv]) return null;
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set(provider.clientIdParam, clientId);
  url.searchParams.set("redirect_uri", redirectUri(platform));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", resolveScopes(platform, provider));
  url.searchParams.set("state", state);
  if (platform === "tiktok") url.searchParams.set("disable_auto_auth", "1");
  return url.toString();
}

export function buildTokenRequest(
  platform: OAuthPlatform,
  code: string,
): { url: string; body: URLSearchParams } | null {
  const provider = PROVIDERS[platform];
  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    [provider.clientIdParam]: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(platform),
  });
  return { url: provider.tokenUrl, body };
}
