/**
 * @jest-environment node
 *
 * The sign-in redirect carries the interrupted page as `callbackUrl`, and the
 * login pages send the visitor there afterwards. Whatever is on that query
 * string was written by whoever made the link, so the one thing this must
 * never do is send somebody off-site.
 */
import { safeCallbackPath, signInPathFor } from "@/lib/callbackPath";
import { authConfig } from "@/lib/auth.config";

describe("safeCallbackPath", () => {
  it.each([
    ["/campaigns/camp-1", "/campaigns/camp-1"],
    ["/settings/team", "/settings/team"],
    ["/dashboard", "/dashboard"],
    ["/campaigns?status=ALL", "/campaigns?status=ALL"],
    ["/campaigns/camp-1?section=posts#top", "/campaigns/camp-1?section=posts#top"],
    ["/", "/"],
  ])("keeps the same-site path %s", (raw, expected) => {
    expect(safeCallbackPath(raw)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "//evil.com/campaigns",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "https://evil.com",
    "http://localhost:3044/campaigns",
    "javascript:alert(1)",
    "evil.com",
    "campaigns",
    "",
  ])("refuses %j", (raw) => {
    expect(safeCallbackPath(raw)).toBeNull();
  });

  it("refuses nothing-at-all", () => {
    expect(safeCallbackPath(null)).toBeNull();
    expect(safeCallbackPath(undefined)).toBeNull();
  });

  it("refuses a path longer than any real link", () => {
    expect(safeCallbackPath(`/campaigns/${"a".repeat(3000)}`)).toBeNull();
  });

  /* A loop between /login and /login, or a landing on a JSON response. */
  it.each(["/login", "/login?callbackUrl=%2Fdashboard", "/signup", "/accept-invite?token=x", "/api/campaigns", "/portal/login"])(
    "refuses the sign-in pages and the API: %s",
    (raw) => {
      expect(safeCallbackPath(raw)).toBeNull();
    },
  );

  it("does not mistake a lookalike for a sign-in page", () => {
    expect(safeCallbackPath("/loginsights")).toBe("/loginsights");
    expect(safeCallbackPath("/apis")).toBe("/apis");
  });

  it("resolves dot segments before deciding, so ../ cannot reach a refused page", () => {
    expect(safeCallbackPath("/campaigns/../api/x")).toBeNull();
    expect(safeCallbackPath("/campaigns/../dashboard")).toBe("/dashboard");
  });

  it("drops Next's client-navigation cache-buster", () => {
    expect(safeCallbackPath("/campaigns/camp-1?_rsc=abc")).toBe("/campaigns/camp-1");
    expect(safeCallbackPath("/campaigns?status=ALL&_rsc=abc")).toBe("/campaigns?status=ALL");
  });

  it("narrows to a surface when asked", () => {
    expect(safeCallbackPath("/portal/stats", { within: "/portal" })).toBe("/portal/stats");
    expect(safeCallbackPath("/campaigns/camp-1", { within: "/portal" })).toBeNull();
    expect(safeCallbackPath("/portalx", { within: "/portal" })).toBeNull();
  });
});

describe("signInPathFor", () => {
  it("encodes the path onto the sign-in page", () => {
    expect(signInPathFor("/login", "/campaigns/camp-1?section=posts")).toBe(
      "/login?callbackUrl=%2Fcampaigns%2Fcamp-1%3Fsection%3Dposts",
    );
  });

  it("is the bare sign-in page when there is nothing safe to carry", () => {
    expect(signInPathFor("/login", "//evil.com")).toBe("/login");
    expect(signInPathFor("/login", null)).toBe("/login");
  });
});

describe("the middleware carries the deep link", () => {
  type Verdict = true | Response;
  const authorized = authConfig.callbacks.authorized as (a: { auth: unknown; request: { nextUrl: URL } }) => Verdict;
  const visit = (path: string, loggedIn: boolean) =>
    authorized({
      auth: loggedIn ? { user: { email: "a@b.com" } } : null,
      request: { nextUrl: new URL(`https://app.test${path}`) },
    });
  const location = (v: Verdict) => (v instanceof Response ? new URL(v.headers.get("location") ?? "") : null);

  it.each(["/campaigns/x", "/settings/team", "/dashboard", "/campaigns?status=ALL"])(
    "signed out, %s goes to /login with the path to come back to",
    (path) => {
      const to = location(visit(path, false));
      expect(to?.origin).toBe("https://app.test");
      expect(to?.pathname).toBe("/login");
      expect(to?.searchParams.get("callbackUrl")).toBe(path);
    },
  );

  it("signed in, a /login link carrying a destination goes there", () => {
    const to = location(visit("/login?callbackUrl=%2Fcampaigns%2Fx", true));
    expect(to?.pathname).toBe("/campaigns/x");
    expect(to?.origin).toBe("https://app.test");
  });

  it("signed in, a /login link carrying an off-site destination goes to /dashboard", () => {
    for (const bad of ["%2F%2Fevil.com", "https%3A%2F%2Fevil.com", "%2F%5Cevil.com"]) {
      const to = location(visit(`/login?callbackUrl=${bad}`, true));
      expect(to?.origin).toBe("https://app.test");
      expect(to?.pathname).toBe("/dashboard");
    }
  });

  it("signed in, any other auth page still goes to /dashboard", () => {
    expect(location(visit("/signup?callbackUrl=%2Fcampaigns%2Fx", true))?.pathname).toBe("/dashboard");
  });
});
