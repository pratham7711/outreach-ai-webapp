/**
 * Where to send somebody after they sign in, when the sign-in interrupted them.
 *
 * Signed out, /campaigns/x, /settings/team and /dashboard all used to redirect
 * to a bare /login, and the login page always went on to /campaigns -- so a link
 * a colleague pasted into Slack opened the campaign list, and the person had to
 * find the campaign again by hand. The middleware (lib/auth.config) now puts the
 * interrupted path on the redirect as `callbackUrl`, and the login page reads it
 * back.
 *
 * Anything that comes back off a query string was typed by whoever made the
 * link, so this is the one place that decides what may be honoured, and it only
 * ever answers with a path on this site:
 *
 *   - It must be a relative path: one leading "/" and nothing that a browser
 *     reads as a scheme or a host. "//evil.com" and "/\evil.com" are both
 *     protocol-relative to a browser, and "https://evil.com" is absolute; all
 *     three are refused, as is anything with a backslash or a control
 *     character (a tab or newline inside "/\t/evil.com" is stripped by the URL
 *     parser and leaves "//evil.com").
 *   - It is then resolved against a placeholder origin and must still be on
 *     it, which catches whatever the string checks above did not think of.
 *   - The sign-in pages themselves are refused, so a link can never bounce
 *     somebody between /login and /login, and so are /api routes, which answer
 *     with JSON rather than a page.
 *
 * `within` narrows it further for a surface that has its own sign-in: the
 * creator portal passes "/portal", so its login can only land a creator back
 * inside the portal.
 */
export const CALLBACK_PARAM = "callbackUrl";

const PLACEHOLDER_ORIGIN = "http://callback.invalid";
const MAX_LENGTH = 2048;

/* Pages a callback must never point at. Matched as whole segments. */
const REFUSED_ROOTS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/portal/login",
  "/portal/register",
  "/api",
];

function underSegment(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function safeCallbackPath(
  raw: string | null | undefined,
  options: { within?: string } = {},
): string | null {
  if (typeof raw !== "string" || raw === "" || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;

  /* Next's own cache-buster on a client-side navigation, never part of a link
     anybody shared; carrying it back would request the RSC payload, not the page. */
  if (url.searchParams.has("_rsc")) url.searchParams.delete("_rsc");
  const path = url.pathname;
  if (REFUSED_ROOTS.some((root) => underSegment(path, root))) return null;
  if (options.within && !underSegment(path, options.within)) return null;
  return `${path}${url.search}${url.hash}`;
}

/** The sign-in page for an interrupted visit, carrying the path to come back to. */
export function signInPathFor(loginPath: string, interrupted: string | null | undefined, options: { within?: string } = {}): string {
  const back = safeCallbackPath(interrupted, options);
  return back ? `${loginPath}?${CALLBACK_PARAM}=${encodeURIComponent(back)}` : loginPath;
}

/**
 * The creator portal's sign-in, carrying the portal page the creator is on now.
 *
 * The portal is not behind the middleware -- its pages find out they are
 * signed out when an API call answers 401, and each one then pushed a bare
 * /portal/login, so a creator who tapped a link to their stats signed in and
 * landed on Home. Client-side only; on the server it is the bare sign-in.
 */
export function portalSignInHere(): string {
  if (typeof window === "undefined") return "/portal/login";
  return signInPathFor("/portal/login", `${window.location.pathname}${window.location.search}`, { within: "/portal" });
}
