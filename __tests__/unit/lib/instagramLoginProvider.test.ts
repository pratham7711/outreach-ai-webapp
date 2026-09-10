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
  "FACEBOOK_CLIENT_ID",
  "FACEBOOK_CLIENT_SECRET",
  "INSTAGRAM_LOGIN_CLIENT_ID",
  "INSTAGRAM_LOGIN_CLIENT_SECRET",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;

const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});
beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.APP_URL = "https://campaign.example.com";
});
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("the instagram-login provider", () => {
  it("is registered and maps to the INSTAGRAM enum", () => {
    expect(OAUTH_PLATFORMS).toContain("instagram-login");
    expect(isOAuthPlatform("instagram-login")).toBe(true);
    /* One Platform enum value for both paths: a creator's Instagram account is
       the same account however they authorised it, and splitting the enum would
       fork every metric query and report in the app. */
    expect(toPlatformEnum("instagram-login")).toBe("INSTAGRAM");
    expect(toPlatformEnum("instagram")).toBe("INSTAGRAM");
  });

  it("does NOT replace the Facebook Login path", () => {
    /* business_discovery — public numbers for creators who never authorised us
       — exists only on the Page path. Losing it would break the agency-side
       Instagram collector for every unconnected creator. */
    expect(OAUTH_PLATFORMS).toContain("instagram");
  });

  it("keeps its own callback URL, so the two paths cannot collide", () => {
    expect(redirectUri("instagram-login")).toBe(
      "https://campaign.example.com/api/portal/connections/instagram-login/callback",
    );
    expect(redirectUri("instagram-login")).not.toBe(redirectUri("instagram"));
  });

  it("refuses to run on the Facebook app's credentials", () => {
    /* The single most likely misconfiguration, and it fails in a way that looks
       like a broken creator rather than a wrong variable: instagram.com answers
       invalid_client_id for a Facebook app id. There is deliberately no
       fallback, unlike the Facebook provider which may borrow Instagram's. */
    process.env.INSTAGRAM_CLIENT_ID = "fb-app-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "fb-app-secret";
    process.env.FACEBOOK_CLIENT_ID = "fb-app-id";
    process.env.FACEBOOK_CLIENT_SECRET = "fb-app-secret";
    expect(isProviderConfigured("instagram")).toBe(true);
    expect(isProviderConfigured("instagram-login")).toBe(false);
    expect(buildAuthorizeUrl("instagram-login", "state-1")).toBeNull();
  });

  it("authorises on instagram.com with the Instagram-Login scopes", () => {
    process.env.INSTAGRAM_LOGIN_CLIENT_ID = "ig-app-id";
    process.env.INSTAGRAM_LOGIN_CLIENT_SECRET = "ig-app-secret";

    const url = new URL(buildAuthorizeUrl("instagram-login", "state-1")!);
    /* Not facebook.com: this dialog involves no Page, and the token it mints is
       read at graph.instagram.com. */
    expect(url.host).toBe("www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("ig-app-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-1");

    const scopes = (url.searchParams.get("scope") ?? "").split(",");
    expect(scopes).toEqual([
      "instagram_business_basic",
      "instagram_business_manage_insights",
    ]);
    /* Neither has a screen, and a scope with no screen is what sank the last
       submission. */
    expect(scopes).not.toContain("instagram_business_manage_comments");
    expect(scopes).not.toContain("instagram_business_content_publish");
    /* Page-path scopes must not leak onto a flow with no Page in it. */
    expect(scopes).not.toContain("pages_show_list");
    expect(scopes).not.toContain("instagram_basic");
  });

  it("exchanges the code on api.instagram.com", () => {
    process.env.INSTAGRAM_LOGIN_CLIENT_ID = "ig-app-id";
    process.env.INSTAGRAM_LOGIN_CLIENT_SECRET = "ig-app-secret";

    const req = buildTokenRequest("instagram-login", "the-code")!;
    expect(new URL(req.url).host).toBe("api.instagram.com");
    expect(req.body.get("client_id")).toBe("ig-app-id");
    expect(req.body.get("client_secret")).toBe("ig-app-secret");
    expect(req.body.get("grant_type")).toBe("authorization_code");
    expect(req.body.get("code")).toBe("the-code");
    /* Must match the authorize call's redirect_uri exactly or Instagram
       rejects the exchange. */
    expect(req.body.get("redirect_uri")).toBe(redirectUri("instagram-login"));
  });

  it("stays absent until its own credentials are set", () => {
    /* Every environment today. The connect button is correctly missing rather
       than present-and-failing, which is what "auto" in DEFAULT_CONNECT buys. */
    expect(isProviderConfigured("instagram-login")).toBe(false);
    process.env.INSTAGRAM_LOGIN_CLIENT_ID = "ig-app-id";
    expect(isProviderConfigured("instagram-login")).toBe(false);
    process.env.INSTAGRAM_LOGIN_CLIENT_SECRET = "ig-app-secret";
    expect(isProviderConfigured("instagram-login")).toBe(true);
  });
});
