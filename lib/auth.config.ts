import type { NextAuthConfig } from "next-auth";
import { CALLBACK_PARAM, safeCallbackPath, signInPathFor } from "@/lib/callbackPath";

/** `path` is `root` itself or something beneath it -- a segment match, so
 *  "/invite" covers "/invite/abc" and never "/invites". */
function underSegment(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

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
      // A creator list shared with a brand (/l/<token>); the token is the auth.
      const isPublicListPage = nextUrl.pathname.startsWith("/l/");
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
        nextUrl.pathname.startsWith("/terms") ||
        underSegment(nextUrl.pathname, "/data-deletion") ||
        underSegment(nextUrl.pathname, "/about");
      /* The creator app's two ways in that need no account: an agency's connect
         link (/connect/<token>) and its campaign invite (/invite/<code>). Both
         are opened from inside Instagram, TikTok or WhatsApp, usually on a phone
         with no session of any kind, and the token in the path is the
         authorisation. Matched as whole segments, never as prefixes:
         startsWith("/connect") would also open /connections, an agency page. */
      const isCreatorEntryPage =
        underSegment(nextUrl.pathname, "/connect") ||
        underSegment(nextUrl.pathname, "/invite");
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
        /^\/(?:[^/]+|(?:fonts|landing|\.well-known)\/[^/]+)\.(?:jpg|jpeg|png|gif|svg|webp|avif|ico|woff2?|txt|xml|webmanifest)$/i.test(
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
        isPublicListPage ||
        isPublicLegalPage ||
        isCreatorEntryPage ||
        isVerifyEmailPage
      )
        return true;
      /* The interrupted path rides along as callbackUrl, so signing in lands
         on the campaign somebody was sent rather than the campaign list. Only
         ever a path on this site: see lib/callbackPath. */
      if (!isLoggedIn && !isAuthPage) {
        return Response.redirect(new URL(signInPathFor("/login", `${nextUrl.pathname}${nextUrl.search}`), nextUrl));
      }
      if (isLoggedIn && isAuthPage) {
        /* Somebody already signed in who opens a /login link that carries a
           destination -- a second tab, or a link copied while signed out --
           goes there rather than to /dashboard. */
        const back = underSegment(nextUrl.pathname, "/login")
          ? safeCallbackPath(nextUrl.searchParams.get(CALLBACK_PARAM))
          : null;
        return Response.redirect(new URL(back ?? "/dashboard", nextUrl));
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
