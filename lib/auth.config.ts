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
      /* Reachable in EITHER auth state, which is why it does not belong with
         the auth pages below.
         Signed out, because a confirmation link is opened from a mail client
         and routinely on a device with no session: bouncing it to /login
         spends nothing and leaves the address unproven, the one outcome this
         flow exists to prevent. Signed IN as well, because isAuthPage sends a
         logged-in visitor to /dashboard -- and somebody who signed up, signed
         in, then went back to the email is the ordinary case, not the edge. It
         reads the token, never the session, so neither state is special. */
      const isVerifyEmailPage = nextUrl.pathname.startsWith("/verify-email");
      const isPublicLegalPage =
        nextUrl.pathname.startsWith("/privacy") ||
        nextUrl.pathname.startsWith("/terms");
      // Files under public/ are served to anyone by definition, but the proxy
      // matcher only exempts _next and favicon, so without this every image
      // redirects to /login — including the og:image a social crawler fetches.
      //
      // Match where the files actually live, not "any path with an image
      // extension": a bare extension test also matches /campaigns/<id>.png,
      // which hands an unauthenticated visitor a dashboard route. Adding a new
      // directory under public/ means adding it here — the failure mode is a
      // missing image, which you see, rather than a silent auth bypass.
      const isPublicFile =
        /^\/(?:[^/]+|(?:fonts|landing)\/[^/]+)\.(?:jpg|jpeg|png|gif|svg|webp|avif|ico|woff2?|txt|xml|webmanifest)$/i.test(
          nextUrl.pathname
        );
      if (isPublicFile) return true;
      if (nextUrl.pathname === "/") {
        return isLoggedIn ? Response.redirect(new URL("/campaigns", nextUrl)) : true;
      }
      const isAuthPage =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/signup") ||
        nextUrl.pathname.startsWith("/forgot-password") ||
        nextUrl.pathname.startsWith("/reset-password") ||
        // An invited colleague has no account yet, so this must be reachable
        // signed-out — otherwise the invite link bounces to /login and the
        // person is asked to sign in to an account they are here to create.
        nextUrl.pathname.startsWith("/accept-invite");
      // Portal, public creator pages, and public marketplace skip org auth
      if (
        isPortalPage ||
        isPublicCreatorPage ||
        isPublicMarketplacePage ||
        isPublicSharePage ||
        isPublicLegalPage ||
        isVerifyEmailPage
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
