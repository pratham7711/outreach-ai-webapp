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
    authorizeUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scopes: ["instagram_basic", "instagram_manage_insights"],
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
  const scopeOverride =
    platform === "tiktok" ? process.env.TIKTOK_SCOPES?.trim() : undefined;
  url.searchParams.set(
    "scope",
    scopeOverride || provider.scopes.join(provider.scopeSeparator),
  );
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
