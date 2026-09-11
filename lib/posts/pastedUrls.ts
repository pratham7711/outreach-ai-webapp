/**
 * Pulling post links out of a pasted blob.
 *
 * Operators receive links in batches -- a client sends the week's ten in one
 * message -- so the Add Post dialog takes the message as-is rather than making
 * someone split it into ten separate adds. Lives apart from the dialog so it
 * can be tested without pulling the component's UI dependencies into jest.
 */
import { detectPlatform } from "@/lib/platforms/fetchPostMetrics";

/** A guard, not a product limit: a stray paste of a whole document should be
 *  refused rather than fired at the API a few hundred times. */
export const MAX_BULK_POSTS = 50;

/**
 * Every URL in the blob, in the order it was pasted, with repeats marked.
 *
 * `duplicate` is true for the SECOND and later appearance of a post, never the
 * first, so the dialog can show the repeat in red instead of silently dropping
 * it -- an operator who pasted ten links and got nine rows had no way to tell
 * which one vanished.
 */
export type PastedUrl = {
  url: string;
  /** platform:id where the link named a post, else the normalised URL. */
  key: string;
  duplicate: boolean;
};

/* A URL runs until whitespace, a comma, or the start of the next one. That last
   clause is the one that matters: pasting twice without pressing Enter in
   between yields "…web_id=7522952180069598734https://www.tiktok.com/@…", which
   splitting on whitespace alone reads as a single link -- one mangled link, not
   two good ones, and the operator is told "1 link found" with no hint that half
   their paste is inside it. */
const URL_RUN = /https?:\/\/(?:(?!https?:\/\/)[^\s,])+/gi;

/**
 * What makes two links the same post.
 *
 * Not the raw string: TikTok's share sheet appends is_from_webapp, sender_device
 * and a per-browser web_id, so the same video copied from two places gives two
 * different URLs. The platform's own post id is the identity, and the URL is
 * only a fallback for a link no detector claims.
 */
export function postIdentityKey(url: string): string {
  const detected = detectPlatform(url);
  if (detected) return `${detected.platform}:${detected.id}`;
  /* No detector claims it, so the URL is the identity. Only the fragment is
     dropped -- a query string is where an unrecognised platform is most likely
     to keep the thing that makes two of its pages different, and merging two
     genuinely separate posts is the worse of the two mistakes. */
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Splits a pasted blob into links, keeping repeats so they can be shown.
 *
 * Trailing punctuation is stripped because prose leaves it behind ("see <link>,
 * and ..."), which is also why commas separate.
 */
export function parsePastedPostEntries(text: string): PastedUrl[] {
  const seen = new Set<string>();
  const out: PastedUrl[] = [];
  for (const raw of text.match(URL_RUN) ?? []) {
    const url = raw.trim().replace(/[)\]}>,.]+$/, "");
    if (!/^https?:\/\/./i.test(url)) continue;
    const key = postIdentityKey(url);
    out.push({ url, key, duplicate: seen.has(key) });
    seen.add(key);
  }
  return out;
}

/**
 * The de-duplicated links, which is what a caller counting work to do wants.
 * Order is the paste's own, so the rows on screen match what was pasted.
 */
export function parsePastedPostUrls(text: string): string[] {
  return parsePastedPostEntries(text)
    .filter((e) => !e.duplicate)
    .map((e) => e.url);
}
