import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isPortalPage = nextUrl.pathname.startsWith("/portal");
      const isPublicCreatorPage = nextUrl.pathname.startsWith("/c/");
      // Public marketplace (Phase 2M) — unauthenticated /explore browsing.
      const isPublicMarketplacePage = nextUrl.pathname.startsWith("/explore");
      const isPublicSharePage = nextUrl.pathname.startsWith("/share/");
      const isPublicLegalPage =
        nextUrl.pathname.startsWith("/privacy") ||
        nextUrl.pathname.startsWith("/terms");
      // Files under public/ are served to anyone by definition, but the proxy
      // matcher only exempts _next and favicon, so without this every image
      // redirects to /login — including the og:image a social crawler fetches.
      const isStaticAsset =
        /\.(?:jpg|jpeg|png|gif|svg|webp|avif|ico|woff2?|txt|xml|webmanifest)$/i.test(
          nextUrl.pathname
        );
      if (isStaticAsset) return true;
      if (nextUrl.pathname === "/") {
        return isLoggedIn ? Response.redirect(new URL("/campaigns", nextUrl)) : true;
      }
      const isAuthPage =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/signup") ||
        nextUrl.pathname.startsWith("/forgot-password") ||
        nextUrl.pathname.startsWith("/reset-password");
      // Portal, public creator pages, and public marketplace skip org auth
      if (
        isPortalPage ||
        isPublicCreatorPage ||
        isPublicMarketplacePage ||
        isPublicSharePage ||
        isPublicLegalPage
      )
        return true;
      if (!isLoggedIn && !isAuthPage) {
        return Response.redirect(new URL("/login", nextUrl));
      }
      if (isLoggedIn && isAuthPage) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
