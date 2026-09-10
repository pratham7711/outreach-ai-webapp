import type { OAuthPlatform } from "@/lib/oauth/providers";

/**
 * How a `CreatorSocialAccount` row came to exist.
 *
 * One column, one dimension: the provenance of the row. It answers two
 * questions that were previously unanswerable without decrypting the token and
 * string-matching it:
 *
 *   - **Does this row hold a credential at all?** A hand-entered row's
 *     accessToken is the literal string "manual-entry"
 *     (app/api/creators/[id]/social-accounts), yet /api/portal/connections
 *     reports `connected: true` for it and a provenance badge would call it
 *     Verified. "manual" is what makes it excludable.
 *   - **Which OAuth flow minted it?** Both Instagram paths write
 *     `platform = INSTAGRAM`, and they differ in the host their reads go to and
 *     in whether a revoke endpoint exists. Aiming Facebook's
 *     `DELETE me/permissions` at an Instagram-Login token would 400 — and the
 *     disconnect route swallows revoke failures, so the creator would be told
 *     the grant was withdrawn while it stayed live at Instagram.
 */
export const ACCOUNT_ORIGINS = {
  /** Facebook Login for Business, TikTok, YouTube, Facebook Pages, Threads. */
  OAUTH: "oauth",
  /** Instagram Login — no Facebook Page, reads at graph.instagram.com. */
  OAUTH_INSTAGRAM_LOGIN: "oauth_instagram_login",
  /** An agency typed the handle in. Holds no token. */
  MANUAL: "manual",
  /** The non-production connect shortcut in the start route. */
  DEV: "dev",
} as const;

export type AccountOrigin = (typeof ACCOUNT_ORIGINS)[keyof typeof ACCOUNT_ORIGINS];

/** The origin a completed OAuth consent on this platform should record. */
export function originForPlatform(platform: OAuthPlatform): AccountOrigin {
  return platform === "instagram-login"
    ? ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN
    : ACCOUNT_ORIGINS.OAUTH;
}

/**
 * Whether a row's token was minted by Instagram Login.
 *
 * `null` — every row written before this column existed — reads as false, which
 * is right: the Instagram-Login flow did not exist then, so no legacy row can
 * have come from it. The consequence is that legacy Instagram rows keep going
 * to the Facebook revoke, which is where they came from.
 */
export function isInstagramLoginRow(origin: string | null | undefined): boolean {
  return origin === ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN;
}

/**
 * Whether a row holds a real credential.
 *
 * Both OAuth origins do. "manual" never does, "dev" holds a synthetic one, and
 * `null` is unknown — a row from before the column existed, which may be either
 * — so it is NOT reported as authorized. A provenance badge that has to choose
 * between overstating and understating should understate.
 */
export function isAuthorizedOrigin(origin: string | null | undefined): boolean {
  return (
    origin === ACCOUNT_ORIGINS.OAUTH ||
    origin === ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN
  );
}
