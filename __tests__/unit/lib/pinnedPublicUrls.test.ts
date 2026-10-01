/**
 * @jest-environment node
 */

/**
 * URLs that something outside this repo depends on.
 *
 * Meta, TikTok and Google hold our OAuth callback and data-deletion URLs in
 * their consoles, and app review checks them. Agencies have already sent
 * clients /share/ and /l/ links, creators hold /c/ and /portal/register?join=
 * links, and reviewers open /, /privacy and /terms signed out. Moving any of
 * them breaks someone who never sees our deploy, so each is pinned here: the
 * file behind it must exist, and the middleware must let a signed-out visitor
 * reach the public ones.
 */
import fs from "fs";
import path from "path";
import { authConfig } from "@/lib/auth.config";
import { OAUTH_PLATFORMS, redirectUri } from "@/lib/oauth/providers";

const root = path.resolve(__dirname, "../../..");
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

type Verdict = true | Response;
const authorized = authConfig.callbacks.authorized as (a: {
  auth: unknown;
  request: { nextUrl: URL };
}) => Verdict;
const signedOut = (p: string) =>
  authorized({ auth: null, request: { nextUrl: new URL(`https://app.test${p}`) } });

describe("OAuth callbacks registered with Meta, TikTok and Google", () => {
  const registered = ["instagram", "instagram-login", "facebook", "threads", "youtube", "tiktok"];

  it.each(registered)("%s is still a platform", (platform) => {
    expect(OAUTH_PLATFORMS as readonly string[]).toContain(platform);
  });

  it.each(registered)("%s keeps its callback URL", (platform) => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = "https://campaign.madeboring.com";
    try {
      expect(redirectUri(platform as (typeof OAUTH_PLATFORMS)[number])).toBe(
        `https://campaign.madeboring.com/api/portal/connections/${platform}/callback`
      );
    } finally {
      if (prev === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev;
    }
  });

  it.each(["start", "callback"])("the %s route exists", (step) => {
    expect(exists(`app/api/portal/connections/[platform]/${step}/route.ts`)).toBe(true);
  });
});

describe("Meta deauthorize and data-deletion webhooks", () => {
  it.each(["deauthorize", "data-deletion"])("/api/webhooks/meta/%s exists", (hook) => {
    expect(exists(`app/api/webhooks/meta/${hook}/route.ts`)).toBe(true);
  });
});

describe("TikTok's domain verification file", () => {
  it("is still served from public/", () => {
    const files = fs.readdirSync(path.join(root, "public"));
    expect(files.some((f) => /^tiktok[A-Za-z0-9]+\.txt$/.test(f))).toBe(true);
  });
});

describe("public pages", () => {
  const pages: Array<[string, string]> = [
    ["/", "app/page.tsx"],
    ["/privacy", "app/(public)/privacy/page.tsx"],
    ["/terms", "app/(public)/terms/page.tsx"],
    ["/explore", "app/(public)/explore/page.tsx"],
    ["/c/somecreator", "app/(public)/c/[handle]/page.tsx"],
    ["/l/sometoken", "app/(public)/l/[token]/page.tsx"],
    ["/share/sometoken", "app/(public)/share/[token]/page.tsx"],
    ["/portal/register?join=some-campaign", "app/(portal)/portal/register/page.tsx"],
    ["/accept-invite?token=x", "app/(auth)/accept-invite/page.tsx"],
  ];

  it.each(pages)("%s has its page", (_url, file) => {
    expect(exists(file)).toBe(true);
  });

  it.each(pages)("%s opens signed out", (url) => {
    expect(signedOut(url)).toBe(true);
  });

  it("the TikTok verification file opens signed out", () => {
    const file = fs.readdirSync(path.join(root, "public")).find((f) => f.startsWith("tiktok"));
    expect(signedOut(`/${file}`)).toBe(true);
  });
});

describe("links agencies already use inside the app", () => {
  it("/lists/<id> still has its page", () => {
    expect(exists("app/(dashboard)/lists/[id]/page.tsx")).toBe(true);
  });
});
