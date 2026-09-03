/* Shared by the tracker route and campaign creation, both of which accept a
   pasted share link. Extracted so the host allow-list below has one home: two
   copies of an SSRF guard is one copy too many. */

/**
 * Follow a share link far enough to see the sound behind it.
 *
 * vm./vt. links carry an opaque token and no id, so the only way to learn one
 * is to ask where the link goes. A redirect is served before TikTok's app boots,
 * so unlike the count this *can* be read server-side.
 *
 * Manual redirects, and every hop re-checked against the TikTok host set: an
 * open redirect on a shortener would otherwise turn this endpoint into a
 * request forgery primitive pointed at whatever the attacker likes.
 */
const MAX_HOPS = 3;

export async function expandShortLink(input: string): Promise<string | null> {
  let current = input;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      return null;
    }
    const location = res.headers.get("location");
    if (!location) return current; // no further hop: this is the destination

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }
    if (!/(^|\.)tiktok\.com$/i.test(next.hostname)) return null;
    current = next.toString();
  }
  return current;
}
