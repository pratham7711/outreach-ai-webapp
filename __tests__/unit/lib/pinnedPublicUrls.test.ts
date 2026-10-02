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

/* ── Every public door, enumerated rather than remembered ─────────────────────
   The list above names the URLs someone outside holds. This block answers the
   wider question the middleware actually decides: which pages may a signed-out
   visitor open at all. It walks the route groups on disk, so a public page added
   later is covered the day it lands and a protected one cannot slip into the
   allowlist unnoticed -- editing that allowlist is how an agency's share links
   would start bouncing to /login, and a 302 is invisible in a green suite. */

/** Every page.tsx under `dir`, as the URL it serves, with dynamic segments filled. */
function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name === "page.tsx") out.push(child);
    }
  };
  walk(path.join(root, dir));
  return out.map((file) => {
    const rel = path.relative(path.join(root, "app"), path.dirname(file));
    const segments = rel
      .split(path.sep)
      .filter((s) => !/^\(.*\)$/.test(s))
      .map((s) => (/^\[.*\]$/.test(s) ? "sample-segment" : s));
    return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
  });
}

const signedIn = (p: string) =>
  authorized({ auth: { user: { email: "a@b.com" } }, request: { nextUrl: new URL(`https://app.test${p}`) } });
const redirectTarget = (v: Verdict) =>
  v instanceof Response ? new URL(v.headers.get("location") ?? "").pathname : null;

describe("every page in the public route group opens signed out", () => {
  const publicPages = pagesUnder("app/(public)");

  it("finds the public pages on disk", () => {
    // A walk that returns nothing would pass every case below vacuously.
    expect(publicPages.length).toBeGreaterThanOrEqual(7);
  });

  it.each(publicPages)("%s", (url) => {
    expect(signedOut(url)).toBe(true);
  });

  /* A share link is opened by a client who may well be signed in to their own
     agency account; the public pages must not bounce them either. */
  it.each(publicPages)("%s also opens signed in", (url) => {
    expect(signedIn(url)).toBe(true);
  });
});

describe("every auth page opens signed out", () => {
  const authPages = pagesUnder("app/(auth)");

  it("finds the auth pages on disk", () => {
    expect(authPages.length).toBeGreaterThanOrEqual(6);
  });

  it.each(authPages)("%s", (url) => {
    expect(signedOut(url)).toBe(true);
  });
});

describe("the creator portal is outside agency auth", () => {
  /* The portal has its own session (lib/creator-auth.ts) and every page in it
     checks that session itself; agency middleware must never bounce a creator
     to the agency /login. */
  const portalPages = pagesUnder("app/(portal)");

  it("finds the portal pages on disk", () => {
    expect(portalPages.length).toBeGreaterThanOrEqual(2);
  });

  it.each(portalPages)("%s opens signed out", (url) => {
    expect(signedOut(url)).toBe(true);
  });

  it("keeps the pinned join link open with both of its parameters", () => {
    expect(signedOut("/portal/register?join=some-campaign&invite=CODE1")).toBe(true);
    expect(signedOut("/portal/login?join=some-campaign&invite=CODE1")).toBe(true);
  });
});

describe("every agency page stays behind /login", () => {
  /* The inverse guard: opening a public door must never open an app page. The
     two that are deliberately reachable signed out (the landing at "/" is not in
     this group) are excluded by construction. */
  const appPages = pagesUnder("app/(dashboard)");

  it("finds the agency pages on disk", () => {
    expect(appPages.length).toBeGreaterThanOrEqual(30);
  });

  it.each(appPages)("%s redirects a signed-out visitor to /login", (url) => {
    expect(redirectTarget(signedOut(url))).toBe("/login");
  });
});

describe("files served from public/", () => {
  const assets = [
    "/app-icon-1024.png",
    "/globe.svg",
    "/landing/og.jpg",
    "/landing/hero.jpg",
    "/fonts/satoshi-400.woff2",
  ];

  it.each(assets)("%s opens signed out", (url) => {
    expect(signedOut(url)).toBe(true);
  });

  /* The extension test must stay anchored to where the files live: a bare
     ".png" match would hand an anonymous visitor an app route. */
  it.each(["/campaigns/abc.png", "/creators/x/y.svg"])("%s does not", (url) => {
    expect(redirectTarget(signedOut(url))).toBe("/login");
  });
});

describe("platform callbacks and webhooks never reach the middleware", () => {
  /* proxy.ts's matcher excludes /api entirely, which is what keeps every OAuth
     callback, the Meta deletion webhooks and the public marketplace API out of
     the auth redirect. Read from the file, not imported: importing proxy.ts
     builds a NextAuth instance this test has no use for. */
  const proxySource = fs.readFileSync(path.join(root, "proxy.ts"), "utf8");
  const matcherSource = proxySource.match(/matcher:\s*\[\s*"([^"]+)"/)?.[1] ?? "";
  const matcher = new RegExp(`^${matcherSource}$`);

  it("still declares a matcher", () => {
    expect(matcherSource).not.toBe("");
  });

  it.each([
    "/api/portal/connections/instagram/callback",
    "/api/portal/connections/tiktok/start",
    "/api/webhooks/meta/data-deletion",
    "/api/webhooks/meta/deauthorize",
    "/api/public/marketplace",
    "/api/cron/sync-trackers",
    "/_next/static/chunk.js",
    "/favicon.ico",
  ])("%s is outside the matcher", (url) => {
    expect(matcher.test(url)).toBe(false);
  });

  it.each(["/campaigns", "/portal/dashboard", "/explore", "/"])("%s is inside it", (url) => {
    expect(matcher.test(url)).toBe(true);
  });
});
