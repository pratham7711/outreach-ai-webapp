import {
  OAUTH_PLATFORMS,
  isOAuthPlatform,
  toPlatformEnum,
  redirectUri,
  isProviderConfigured,
  buildAuthorizeUrl,
  buildTokenRequest,
} from "@/lib/oauth/providers";

const ENV_KEYS = [
  "INSTAGRAM_CLIENT_ID",
  "INSTAGRAM_CLIENT_SECRET",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;

const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("lib/oauth/providers — platform helpers", () => {
  it("recognises exactly the three OAuth platforms", () => {
    expect(OAUTH_PLATFORMS).toEqual(["instagram", "tiktok", "youtube"]);
    for (const p of OAUTH_PLATFORMS) expect(isOAuthPlatform(p)).toBe(true);
    expect(isOAuthPlatform("twitter")).toBe(false);
    expect(isOAuthPlatform("INSTAGRAM")).toBe(false);
    expect(isOAuthPlatform("")).toBe(false);
  });

  it("maps each platform to its Prisma Platform enum value", () => {
    expect(toPlatformEnum("instagram")).toBe("INSTAGRAM");
    expect(toPlatformEnum("tiktok")).toBe("TIKTOK");
    expect(toPlatformEnum("youtube")).toBe("YOUTUBE");
  });

  it("builds the callback redirect URI on the app base URL", () => {
    process.env.APP_URL = "https://app.example.com/";
    expect(redirectUri("tiktok")).toBe(
      "https://app.example.com/api/portal/connections/tiktok/callback",
    );
  });
});

describe("isProviderConfigured", () => {
  it("is false when no credentials are set", () => {
    for (const p of OAUTH_PLATFORMS) expect(isProviderConfigured(p)).toBe(false);
  });

  it("is false when only one of id/secret is set", () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    expect(isProviderConfigured("instagram")).toBe(false);
    delete process.env.INSTAGRAM_CLIENT_ID;
    process.env.INSTAGRAM_CLIENT_SECRET = "ig-secret";
    expect(isProviderConfigured("instagram")).toBe(false);
  });

  it("is true when both id and secret are set, per platform env names", () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "ig-secret";
    process.env.TIKTOK_CLIENT_KEY = "tt-key";
    process.env.TIKTOK_CLIENT_SECRET = "tt-secret";
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
    for (const p of OAUTH_PLATFORMS) expect(isProviderConfigured(p)).toBe(true);
  });
});

describe("buildAuthorizeUrl", () => {
  it("returns null when the provider is unconfigured", () => {
    for (const p of OAUTH_PLATFORMS) expect(buildAuthorizeUrl(p, "st")).toBeNull();
  });

  it("builds an Instagram (Meta) URL with client id, redirect, scopes, state", () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "ig-secret";
    const url = buildAuthorizeUrl("instagram", "state-123");
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    expect(parsed.hostname).toBe("www.facebook.com");
    expect(parsed.searchParams.get("client_id")).toBe("ig-id");
    expect(parsed.searchParams.get("redirect_uri")).toContain(
      "/api/portal/connections/instagram/callback",
    );
    expect(parsed.searchParams.get("scope")).toBe(
      "instagram_basic,instagram_manage_insights",
    );
    expect(parsed.searchParams.get("state")).toBe("state-123");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(url).not.toContain("ig-secret");
  });

  it("builds a TikTok URL using client_key with the tiktok scopes", () => {
    process.env.TIKTOK_CLIENT_KEY = "tt-key";
    process.env.TIKTOK_CLIENT_SECRET = "tt-secret";
    const url = buildAuthorizeUrl("tiktok", "st-2");
    const parsed = new URL(url as string);
    expect(parsed.hostname).toBe("www.tiktok.com");
    expect(parsed.searchParams.get("client_key")).toBe("tt-key");
    expect(parsed.searchParams.get("scope")).toBe("user.info.basic,video.list");
    expect(parsed.searchParams.get("redirect_uri")).toContain(
      "/api/portal/connections/tiktok/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("st-2");
  });

  it("builds a Google URL for YouTube with the readonly scope", () => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
    const url = buildAuthorizeUrl("youtube", "st-3");
    const parsed = new URL(url as string);
    expect(parsed.hostname).toBe("accounts.google.com");
    expect(parsed.searchParams.get("client_id")).toBe("g-id");
    expect(parsed.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.readonly",
    );
    expect(parsed.searchParams.get("redirect_uri")).toContain(
      "/api/portal/connections/youtube/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("st-3");
  });
});

describe("buildTokenRequest", () => {
  it("returns null when the provider is unconfigured", () => {
    for (const p of OAUTH_PLATFORMS) expect(buildTokenRequest(p, "code")).toBeNull();
  });

  it("builds a token exchange request with code, secret, and redirect", () => {
    process.env.TIKTOK_CLIENT_KEY = "tt-key";
    process.env.TIKTOK_CLIENT_SECRET = "tt-secret";
    const req = buildTokenRequest("tiktok", "auth-code-1");
    expect(req).not.toBeNull();
    expect(req?.url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(req?.body.get("client_key")).toBe("tt-key");
    expect(req?.body.get("client_secret")).toBe("tt-secret");
    expect(req?.body.get("code")).toBe("auth-code-1");
    expect(req?.body.get("grant_type")).toBe("authorization_code");
    expect(req?.body.get("redirect_uri")).toContain(
      "/api/portal/connections/tiktok/callback",
    );
  });
});
