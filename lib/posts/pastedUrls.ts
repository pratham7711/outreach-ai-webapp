/**
 * Pulling post links out of a pasted blob.
 *
 * Operators receive links in batches -- a client sends the week's ten in one
 * message -- so the Add Post dialog takes the message as-is rather than making
 * someone split it into ten separate adds. Lives apart from the dialog so it
 * can be tested without pulling the component's UI dependencies into jest.
 */

/** A guard, not a product limit: a stray paste of a whole document should be
 *  refused rather than fired at the API a few hundred times. */
export const MAX_BULK_POSTS = 50;

/**
 * Splits on whitespace and commas, so a newline list, a comma list and a
 * wrapped paragraph all behave the same, and de-duplicates -- the same link
 * twice would otherwise create the same post twice. Order is the paste's own,
 * so the rows on screen match what was pasted.
 */
export function parsePastedPostUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    // Trailing punctuation is what prose leaves behind: "see <link>, and ...".
    const t = raw.trim().replace(/[)\]}>,.]+$/, "");
    if (!/^https?:\/\//i.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
