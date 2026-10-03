/**
 * The platforms the Creators page has a tab for, in tab order. The page counts
 * each one and the client draws each one, so both read this list rather than
 * keeping copies that could drift -- a tab with no count shows a bare label,
 * and a count with no tab is a query nobody sees.
 */
export const CREATOR_PLATFORM_TABS = ["INSTAGRAM", "YOUTUBE", "TIKTOK", "TWITTER"] as const;

export type CreatorPlatformTab = (typeof CREATOR_PLATFORM_TABS)[number];
