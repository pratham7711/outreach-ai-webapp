import { stripAt } from "@/lib/format";

export type CreatorNameParts = { name: string; handle: string | null };

/**
 * What to call a creator: the name, and the @handle beside it.
 *
 * A sign-up with no name was given its handle as one, so "synthpage18 /
 * @synthpage18" would say the same thing twice. The handle is always shown;
 * the name only when it says something the handle does not.
 */
export function creatorNameParts(name: string | null | undefined, handle: string | null | undefined): CreatorNameParts {
  const h = stripAt(handle).trim();
  const n = (name ?? "").trim();
  if (!h) return { name: n || "Unknown creator", handle: null };
  if (!n || stripAt(n).toLowerCase() === h.toLowerCase()) return { name: `@${h}`, handle: null };
  return { name: n, handle: `@${h}` };
}

/** The same on one line of plain text, for option labels, sentences, aria-labels and the PDF. */
export function creatorNameText(name: string | null | undefined, handle: string | null | undefined): string {
  const p = creatorNameParts(name, handle);
  return p.handle ? `${p.name} (${p.handle})` : p.name;
}
