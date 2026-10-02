/**
 * The review half of a shared list: whether the client may approve or decline
 * creators, whether they may leave a note, which extra figures they see, and
 * which platforms' accounts are shown.
 *
 * It rides inside CreatorListShare.fields as a nested `review` object rather
 * than in new columns, because nothing but the share page reads it and nothing
 * filters on it. The display switches the link already had (stats, tags,
 * audience country, price) stay where they were, in parseShareFields.
 *
 * A link minted before review existed has no `review` key and resolves to
 * LEGACY_SHARE_REVIEW -- everything off -- so a brand already holding a
 * read-only link does not wake up to approve/decline buttons. Turning review
 * on for such a link is an explicit switch in the Share panel.
 *
 * Pure module, no `db`: the Share panel and the public page both import it.
 */

export const SHARE_PLATFORMS = [
  "TIKTOK",
  "INSTAGRAM",
  "YOUTUBE",
  "SNAPCHAT",
  "TWITTER",
  "TWITCH",
  "FACEBOOK",
  "THREADS",
  "PINTEREST",
  "LINKEDIN",
] as const;
export type SharePlatform = (typeof SHARE_PLATFORMS)[number];

export type ShareReview = {
  /** Show the approve/decline buttons at all. Off makes the page a read-only deck. */
  approvals: boolean;
  /** Let the client type a reason with a verdict. */
  feedback: boolean;
  /** Engagement rate per creator, measured from synced posts. */
  engagementRate: boolean;
  /** The sum of the list's rates. Only meaningful while price is shown too. */
  rateTotal: boolean;
  /** Which platforms' accounts to render. Empty means every platform. */
  platforms: SharePlatform[];
};

export type ShareReviewSwitch = Exclude<keyof ShareReview, "platforms">;

/** What a link shared today starts with. */
export const DEFAULT_SHARE_REVIEW: ShareReview = {
  approvals: true,
  feedback: true,
  engagementRate: true,
  rateTotal: false,
  platforms: [],
};

/** What a link minted before review existed resolves to: exactly the old page. */
export const LEGACY_SHARE_REVIEW: ShareReview = {
  approvals: false,
  feedback: false,
  engagementRate: false,
  rateTotal: false,
  platforms: [],
};

export const SHARE_REVIEW_SWITCHES: { key: ShareReviewSwitch; label: string }[] = [
  { key: "approvals", label: "Client can approve or decline" },
  { key: "feedback", label: "Client can leave a note" },
  { key: "engagementRate", label: "Engagement rate" },
  { key: "rateTotal", label: "List rates total" },
];

/** The chips the Share panel offers. The rest of SHARE_PLATFORMS are still accepted. */
export const SHARE_PLATFORM_CHIPS: { value: SharePlatform; label: string }[] = [
  { value: "TIKTOK", label: "TikTok" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "SNAPCHAT", label: "Snapchat" },
  { value: "TWITTER", label: "X" },
  { value: "TWITCH", label: "Twitch" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cleanPlatforms(value: unknown): SharePlatform[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<SharePlatform>();
  for (const p of value) {
    if (typeof p === "string" && (SHARE_PLATFORMS as readonly string[]).includes(p)) seen.add(p as SharePlatform);
  }
  return [...seen];
}

/**
 * Applies a stored or posted review object over a base. Every field is checked
 * rather than trusted: a wrong type, a retired key or an unknown platform falls
 * back to the base instead of reaching the page as `undefined`.
 */
export function mergeShareReview(base: ShareReview, raw: unknown): ShareReview {
  const r = asRecord(raw);
  if (!r) return { ...base, platforms: [...base.platforms] };
  const out: ShareReview = { ...base, platforms: [...base.platforms] };
  for (const { key } of SHARE_REVIEW_SWITCHES) {
    if (typeof r[key] === "boolean") out[key] = r[key] as boolean;
  }
  if ("platforms" in r) out.platforms = cleanPlatforms(r.platforms);
  return out;
}

/** The review settings stored on a share's `fields` JSON. */
export function parseShareReview(fields: unknown): ShareReview {
  const review = asRecord(asRecord(fields)?.review);
  if (!review) return { ...LEGACY_SHARE_REVIEW, platforms: [] };
  return mergeShareReview(DEFAULT_SHARE_REVIEW, review);
}

/** True when this platform's accounts should render. Empty selection = all. */
export function platformIncluded(review: Pick<ShareReview, "platforms">, platform: string): boolean {
  return review.platforms.length === 0 || (review.platforms as string[]).includes(platform);
}
