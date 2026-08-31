import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  /*
    Git worktrees live under .claude/worktrees/ inside this project, so their
    package-lock.json sits below ours and Turbopack's root inference picks the
    outermost lockfile. A dev server started in a worktree then compiles the
    main checkout's files instead of the worktree's, and edits appear to do
    nothing. Pinning the root to this config's own directory makes the server
    always build the tree it was started from.
  */
  turbopack: { root: path.dirname(new URL(import.meta.url).pathname) },
  /*
    Post thumbnails and creator avatars are served from CreatorCore's Bubble CDN.
    Allowing the host here lets the built-in optimiser re-encode them, which is
    the only way the HEIC avatars become viewable -- no browser decodes HEIC.
  */
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.cdn.bubble.io" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "*.tiktokcdn-us.com" },
      { protocol: "https", hostname: "*.cdninstagram.com" },
    ],
  },
  /*
    Returning to a page should not re-run its queries. Next keeps fetched RSC
    payloads in an in-memory client cache, but the default reuse window for a
    dynamic route is 0 seconds, so every back-navigation re-rendered the page on
    the server. Thirty seconds is long enough that moving between sections feels
    instant and short enough that a record you just created shows up when you
    navigate back to its list. The cache lives in memory only, so a hard refresh
    still fetches everything fresh.
  */
  /*
    Chromium ships its own binary, so bundling it would break the executable
    path — it has to stay external. But "external" only means "do not bundle";
    something still has to put the files in the function, and Next's tracer
    could not see them, because the reader imports both packages dynamically so
    a static trace finds nothing to follow.

    The first production run said so exactly: "Failed to load external module
    playwright-core: Cannot find module '/var/task/node_modules...'". The browser
    never launched, the cron fell back to the fetch path, and the fetch path
    cannot read a music page — so the run looked identical to TikTok refusing us
    when in fact we had never asked.

    outputFileTracingIncludes is the half that puts the files there.
  */
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/cron/sync-trackers": [
      "./node_modules/@sparticuz/chromium/**",
      "./node_modules/playwright-core/**",
    ],
  },
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
