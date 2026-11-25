import { InstagramAuthError } from "./instagram";
import { connectionHealthFor, decryptPageToken } from "./connectionHealth";
import { ensureFreshInstagramToken, type InstagramAccountTokens } from "./instagramToken";

/**
 * The credentials a Facebook-Login Instagram read can use, best first.
 *
 * `page` is the long-lived Page token stored for the Page behind the
 * connection: Meta documents it as not expiring when minted from a long-lived
 * user token, so it outlives the 60-day user token. `user` is the user token,
 * refreshed if due (undefined once lapsed).
 *
 * Only for reads that address the account by its IG user id
 * (`{ig-user-id}/media`, `/insights`, ...). Anything that starts from `me/...`
 * (me/accounts, me/permissions) needs the user token and must keep using
 * ensureFreshInstagramToken. That the Page token is accepted by these IG User
 * edges is taken from Meta's reference and is unverified against live
 * traffic, which is why withReadToken falls back to the user token.
 */
export type InstagramReadTokens = { page?: string; user?: string };

export async function instagramReadTokens(
  account: (InstagramAccountTokens & { platformUserId?: string | null }) | null | undefined,
  orgId: string,
): Promise<InstagramReadTokens> {
  if (!account) return {};
  const user = await ensureFreshInstagramToken(account, orgId);
  /* Without the stored IG user id the read would have to resolve it through
     me/accounts, which a Page token cannot do. */
  if (!account.platformUserId) return { user };
  const health = (await connectionHealthFor([account.id])).get(account.id);
  return { page: decryptPageToken(health, orgId), user };
}

/**
 * Runs `read` with the Page token first and, when Meta rejects it (an auth
 * error) or the read comes back empty by `failed`'s measure, again with the
 * user token. Returns undefined when no credential is held at all.
 */
export async function withReadToken<T>(
  tokens: InstagramReadTokens,
  read: (token: string) => Promise<T>,
  failed: (result: T) => boolean = (r) => r === null || r === undefined,
): Promise<T | undefined> {
  if (tokens.page) {
    try {
      const result = await read(tokens.page);
      if (!failed(result) || !tokens.user) return result;
    } catch (err) {
      if (!(err instanceof InstagramAuthError) || !tokens.user) throw err;
    }
  }
  return tokens.user ? read(tokens.user) : undefined;
}
