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

/**
 * The links already held, plus whatever this paste adds, as one list.
 *
 * The dialog used to keep the pasted text as its source of truth and derive the
 * rows from it on every keystroke. That works while the text is the only way in
 * and out, but it cannot survive links becoming chips: removing one meant
 * finding and splicing a line out of a blob, and removing the first of a
 * duplicated pair left the second still marked as the repeat of a link that was
 * no longer there. Holding the links themselves and re-deriving `duplicate`
 * across the whole list on every change is what makes a chip a chip.
 *
 * The cap is applied to the combined list, so a paste that would take it past
 * the limit is truncated rather than displacing links already on screen.
 */
export function mergePastedEntries(
  existingUrls: string[],
  text: string,
  max: number = MAX_BULK_POSTS
): PastedUrl[] {
  const seen = new Set<string>();
  const out: PastedUrl[] = [];
  const push = (url: string) => {
    if (out.length >= max) return;
    const key = postIdentityKey(url);
    out.push({ url, key, duplicate: seen.has(key) });
    seen.add(key);
  };
  for (const url of existingUrls) push(url);
  for (const entry of parsePastedPostEntries(text)) push(entry.url);
  return out;
}

/**
 * What a link says on a chip.
 *
 * A chip is a fixed-width object in a wrapping row, and a TikTok share URL is
 * ninety characters of which about twelve identify the post -- rendered whole
 * it is a paragraph, and four of them fill the dialog. The handle and the post
 * id are the two things an operator checks a pasted link against, so those are
 * what the label carries; the full URL stays on the chip's title and on the row
 * below it, because the label is a summary and must never be the only copy.
 */
export function pastedUrlLabel(url: string): string {
  const detected = detectPlatform(url);
  if (detected) {
    const handle = detected.handle?.replace(/^@/, "") ?? "";
    const id = detected.id ?? "";
    const shortId = id.length > 12 ? `${id.slice(0, 5)}…${id.slice(-4)}` : id;
    if (handle && shortId) return `@${handle} · ${shortId}`;
    if (handle) return `@${handle}`;
    if (shortId) return shortId;
  }
  /* No detector claims it. The host plus the last path segment is the most
     identifying pair a bare URL offers, and it is still the operator's link
     rather than a generic "unrecognised". */
  try {
    const u = new URL(url);
    const tail = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
    const label = u.host.replace(/^www\./i, "") + (tail ? `/${tail}` : "");
    return label.length > 40 ? `${label.slice(0, 39)}…` : label;
  } catch {
    return url.length > 40 ? `${url.slice(0, 39)}…` : url;
  }
}
