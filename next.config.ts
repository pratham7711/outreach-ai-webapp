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
  // Chromium ships its own binary; bundling it breaks the executable path.
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
