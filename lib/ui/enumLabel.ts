/**
 * A stored enum as a person would write it: "PENDING_REVIEW" -> "Pending review".
 *
 * Twenty-odd screens printed status and type enums with nothing but
 * `.replace(/_/g, " ")`, so a badge read "PENDING REVIEW" or "IN PROGRESS" --
 * shouted, and a little wider than the column it sat in. The posts list's Status
 * column was sized around exactly that shout. This is the one place the
 * wording comes from, so a badge, a chip and a dropdown cannot each invent
 * their own casing.
 *
 * Sentence case, not Title Case: that is how every hand-written label in the
 * app already reads ("Pending review", "Not public"). Words that are acronyms
 * stay upper case, because "Ugc" is worse than "UGC".
 */
const ACRONYMS = new Set(["UGC", "API", "URL", "ID", "CPM", "CPV", "KPI", "PDF", "CSV", "SMS", "TTL", "OK"]);

export function enumLabel(value: string | null | undefined): string {
  if (!value) return "";
  const words = value.trim().split(/[_\s]+/).filter(Boolean);
  return words
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}
