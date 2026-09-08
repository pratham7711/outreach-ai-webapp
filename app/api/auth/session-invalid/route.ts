import { signOut } from "@/lib/auth";

/**
 * Sign out a session whose organization no longer exists.
 *
 * A JWT session carries orgId, so it keeps working after the organization it
 * points at is gone. Every screen then renders signed-in chrome around data it
 * cannot load and /api/tenant/config answers 404 forever, which reads as a
 * broken product rather than a finished account -- and there is no way out of
 * it from the UI, because the middleware bounces a logged-in visitor away from
 * /login. Measured on prod after the demo-tenant cleanup removed an org whose
 * user still had a live session.
 *
 * A route rather than a redirect straight to /login, because clearing the
 * cookie is the part that has to happen: without it the visitor is sent to
 * /login, found to be logged in, and sent back to the dashboard.
 */
/* The two states that reach here, both of which need the cookie cleared before
   /login will hold: the organization is gone, or the account itself is gone or
   deactivated. Anything else falls back to the org wording rather than echoing
   a caller-supplied string into the page. */
const REASONS = new Set(["org-removed", "account-inactive"]);

export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("reason") ?? "";
  const reason = REASONS.has(asked) ? asked : "org-removed";
  await signOut({ redirectTo: `/login?reason=${reason}` });
}
