/**
 * The CreatorCore importer's verbatim copy of each record, kept server-side.
 *
 * scripts/creatorcore/cc-import.mjs stored the source record under `__cc` in
 * the JSON bag of what it imported: `Post.platformMetrics.__cc` and
 * `Campaign.typeConfig.__cc`. The same record is in the CcPost/CcCampaign
 * tables, and no runtime code reads the copy -- but every route that returned
 * the bag whole shipped it to the browser. Measured on the read-only prod copy
 * 2026-10-13: 114,576 of the 146,610 bytes of GET /api/campaigns (78%), and
 * 499,405 bytes of the largest campaign's detail payload.
 *
 * lib/serialization/postList already rebuilds the post bag key by key for the
 * Posts tab. This is the same rule for the routes that pass a bag through.
 * Read-side only: the column is untouched.
 */
export const IMPORT_COPY_KEY = "__cc";

/** The bag without `__cc`, or the value unchanged when it is not an object holding one. */
export function withoutImportCopy<T>(bag: T): T {
  if (!bag || typeof bag !== "object" || Array.isArray(bag) || !(IMPORT_COPY_KEY in bag)) return bag;
  const rest = { ...(bag as Record<string, unknown>) };
  delete rest[IMPORT_COPY_KEY];
  return rest as T;
}
