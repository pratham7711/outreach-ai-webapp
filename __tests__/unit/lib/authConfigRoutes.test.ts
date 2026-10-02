/**
 * @jest-environment node
 *
 * Node, not jsdom: the callback answers with Response.redirect, and the jsdom
 * environment has no global Response -- so every redirect assertion failed
 * with ReferenceError while the allow assertions passed, which looks like a
 * middleware bug and is not one.
 */

/**
 * Which paths the middleware lets through, and in which auth state.
 *
 * This exists because /verify-email shipped to production reachable by
 * neither: absent from the allowlist it redirected to /login signed out, and
 * adding it to isAuthPage would have redirected signed-IN visitors to
 * /dashboard. Both spend no token and leave the address unproven, which is the
 * single thing the confirmation flow is for. A 302 is invisible in a green
 * test suite, so it is pinned here.
 */
import { authConfig } from "@/lib/auth.config";

type Verdict = true | Response;

const authorized = authConfig.callbacks.authorized as (a: {
  auth: unknown;
  request: { nextUrl: URL };
}) => Verdict;

const visit = (path: string, loggedIn: boolean): Verdict =>
  authorized({
    auth: loggedIn ? { user: { email: "a@b.com" } } : null,
    request: { nextUrl: new URL(`https://app.test${path}`) },
  });

const allowed = (v: Verdict) => v === true;
const redirectsTo = (v: Verdict) =>
  v instanceof Response ? new URL(v.headers.get("location") ?? "").pathname : null;

describe("verify-email is reachable in both auth states", () => {
  it("lets a signed-out visitor through", () => {
    expect(allowed(visit("/verify-email?token=abc", false))).toBe(true);
  });

  /* The bug the first fix introduced: isAuthPage sends logged-in visitors to
     /dashboard, and signing up then returning to the email is the common case. */
  it("lets a signed-in visitor through too", () => {
    expect(allowed(visit("/verify-email?token=abc", true))).toBe(true);
  });
});

describe("the other signed-out doors still open", () => {
  it.each(["/login", "/signup", "/forgot-password", "/reset-password", "/accept-invite"])(
    "%s is reachable signed out",
    (path) => {
      expect(allowed(visit(path, false))).toBe(true);
    }
  );
});

describe("a shared creator list", () => {
  it("opens signed out", () => {
    expect(allowed(visit("/l/abc123token", false))).toBe(true);
  });

  /* "/l/" is one letter from "/lists", the org's own lists. */
  it.each(["/lists", "/lists/abc123", "/l"])("does not open %s", (path) => {
    expect(redirectsTo(visit(path, false))).toBe("/login");
  });
});

describe("the creator app's entry links", () => {
  /* Opened from inside Instagram, TikTok or WhatsApp with no session at all;
     the token in the path is the authorisation. */
  it.each([
    "/connect/tok_abc123",
    "/invite/cinv_abc123",
    "/invite/cinv_abc123?accept=1",
    "/data-deletion",
  ])("%s opens signed out", (path) => {
    expect(allowed(visit(path, false))).toBe(true);
  });

  /* An agency user who taps a creator's link must not be bounced to
     /dashboard the way an auth page would bounce them. */
  it.each(["/connect/tok_abc123", "/invite/cinv_abc123", "/data-deletion"])(
    "%s opens signed in too",
    (path) => {
      expect(allowed(visit(path, true))).toBe(true);
    }
  );

  /* Segment matches, not prefixes: "/connect" is one suffix away from
     "/connections", an agency page, and "/invite" from "/invites". */
  it.each(["/connections", "/connectionsx", "/invites", "/inviteabc", "/data-deletionx"])(
    "does not open %s",
    (path) => {
      expect(redirectsTo(visit(path, false))).toBe("/login");
    }
  );
});

describe("and the app is still protected", () => {
  it("sends a signed-out visitor from an app page to /login", () => {
    expect(redirectsTo(visit("/campaigns", false))).toBe("/login");
  });

  /* Guards the inverse mistake: opening verify-email must not have opened
     anything else to anonymous traffic. */
  it("still protects a nested app page", () => {
    expect(redirectsTo(visit("/campaigns/abc123/posts", false))).toBe("/login");
  });
});
