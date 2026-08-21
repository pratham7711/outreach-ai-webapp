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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
