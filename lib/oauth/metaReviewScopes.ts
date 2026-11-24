/**
 * Meta permissions built and waiting for App Review.
 *
 * They are asked for only while META_REVIEW_SCOPES=1: in Live mode a
 * permission without Advanced Access is granted only to people with a role on
 * the app, so asking every creator and agency for it before approval would
 * put an unapproved line on their consent screen for nothing. Turn it on
 * locally (and for the recording); in production it stays off until Meta
 * approves, and the Unified login configuration in the Meta console gets the
 * creator two at the same time.
 */

/** Asked of the creator: letting a brand partner boost one of their branded
    posts. Comment management is not requested until a feature needs it. */
export const META_CREATOR_REVIEW_SCOPES = ["instagram_branded_content_creator"] as const;

/** Asked of the agency's own Instagram account: Partnership Ads permissions
    and the brand's approved-creators list. business_management is already
    approved; the branded-content endpoints require it beside them. */
export const META_AGENCY_REVIEW_SCOPES = ["business_management", "instagram_branded_content_ads_brand"] as const;

export function metaReviewScopesOn(): boolean {
  return process.env.META_REVIEW_SCOPES === "1";
}

/** Sample answers instead of Meta for the comment and Partnership Ads
    screens, for building and recording locally. Never in production. */
export function metaDemoMocked(): boolean {
  return process.env.META_DEMO_MOCK === "1" && process.env.VERCEL_ENV !== "production";
}
