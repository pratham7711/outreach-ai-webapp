import type { NextAuthConfig } from "next-auth";

export const authConfig = {
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
      const isAuthPage =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/signup") ||
        nextUrl.pathname.startsWith("/forgot-password");
      // Portal, public creator pages, and public marketplace skip org auth
      if (isPortalPage || isPublicCreatorPage || isPublicMarketplacePage) return true;
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
