/**
 * The platforms the Creators page has a tab for, in tab order. The page counts
 * each one and the client draws each one, so both read this list rather than
 * keeping copies that could drift -- a tab with no count shows a bare label,
 * and a count with no tab is a query nobody sees. Twitter has no tab: no
 * roster tracks it, and its creators stay under All.
 */
export const CREATOR_PLATFORM_TABS = ["INSTAGRAM", "YOUTUBE", "TIKTOK"] as const;

/**
 * The tab after the platforms: creators the agency added by hand or import,
 * with no creator account behind them (?source=manual), so they can be found
 * and cleared out apart from the ones who signed up.
 */
export const MANUAL_TAB = "MANUAL";

export type CreatorPlatformTab = (typeof CREATOR_PLATFORM_TABS)[number];
