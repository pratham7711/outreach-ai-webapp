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
