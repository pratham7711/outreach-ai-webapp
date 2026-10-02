/**
 * @jest-environment node
 *
 * "What we read" has to name exactly the permissions each connect flow asks
 * for. The requested set is read from the real authorize URL, so a scope added
 * to lib/oauth/providers.ts without a sentence here fails this test.
 */
import { OAUTH_PLATFORMS, buildAuthorizeUrl, type OAuthPlatform } from "@/lib/oauth/providers";
import { WHAT_WE_READ } from "@/lib/portal/whatWeRead";

const ENV: Record<string, string> = {
  INSTAGRAM_CLIENT_ID: "test-ig-id",
  INSTAGRAM_CLIENT_SECRET: "test-ig-secret",
  INSTAGRAM_LOGIN_CLIENT_ID: "test-igl-id",
  INSTAGRAM_LOGIN_CLIENT_SECRET: "test-igl-secret",
  TIKTOK_CLIENT_KEY: "test-tt-key",
  TIKTOK_CLIENT_SECRET: "test-tt-secret",
  GOOGLE_CLIENT_ID: "test-g-id",
  GOOGLE_CLIENT_SECRET: "test-g-secret",
  FACEBOOK_CLIENT_ID: "test-fb-id",
  FACEBOOK_CLIENT_SECRET: "test-fb-secret",
  THREADS_CLIENT_ID: "test-th-id",
  THREADS_CLIENT_SECRET: "test-th-secret",
};

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  saved.TIKTOK_SCOPES = process.env.TIKTOK_SCOPES;
  delete process.env.TIKTOK_SCOPES;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function requestedScopes(platform: OAuthPlatform): string[] {
  const url = buildAuthorizeUrl(platform, "state");
  if (!url) throw new Error(`${platform} is not configured in this test`);
  const raw = new URL(url).searchParams.get("scope") ?? "";
  return raw.split(/[\s,]+/).filter(Boolean).sort();
}

describe("WHAT_WE_READ", () => {
  it.each(OAUTH_PLATFORMS.map((p) => [p]))("names every scope %s requests, and no other", (platform) => {
    const described = WHAT_WE_READ[platform].map((r) => r.scope).sort();
    expect(described).toEqual(requestedScopes(platform));
  });

  it("says something for every permission", () => {
    for (const platform of OAUTH_PLATFORMS) {
      for (const read of WHAT_WE_READ[platform]) {
        expect(read.reads.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it("claims no audience data, which no connect flow reads", () => {
    const text = JSON.stringify(WHAT_WE_READ).toLowerCase();
    expect(text).not.toMatch(/\b(audience|demographics?|ages?|gender|country|countries)\b/);
  });
});
