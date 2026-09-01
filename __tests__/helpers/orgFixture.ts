/**
 * The organization row getOrgEntitlements reads.
 *
 * Routes acquired an entitlements check -- seat limits, tracker limits, chart
 * granularity -- after these suites were written, and every one of them reads
 * the same single row: db.organization.findUnique with planConfig included.
 * Three suites went red at once with "Cannot read properties of undefined
 * (reading 'findUnique')", which reads as broken product code rather than a
 * mock that has fallen behind, and stayed red long enough to stop being
 * noticed.
 *
 * One fixture rather than three copies, because the next field the entitlements
 * reader needs should be added in one place. The real getOrgEntitlements runs
 * against it: the limit arithmetic is worth exercising, and mocking the module
 * would only hide the same drift somewhere else.
 */
export type OrgFixtureOverrides = {
  plan?: string;
  planConfig?: Record<string, unknown> | null;
  uiConfig?: unknown;
};

export function orgFixture(overrides: OrgFixtureOverrides = {}) {
  return {
    id: "org-1",
    name: "Test Org",
    /* "starter" -- deliberately NOT "free", which is what a real signup now
       gets. free allows 0 trackers, so defaulting to it would make every suite
       that adds a tracker fail on the limit rather than on what it is testing.
       The free tier is covered explicitly instead, with plan: "free". */
    plan: overrides.plan ?? "starter",
    planConfig: overrides.planConfig === undefined ? null : overrides.planConfig,
    brandName: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    fontFamily: null,
    uiConfig: overrides.uiConfig ?? null,
  };
}
