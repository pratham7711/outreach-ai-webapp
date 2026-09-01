/**
 * @jest-environment node
 *
 * Trackers are the only thing a plan limits.
 *
 * The trap this guards is not the plan table, which is easy to read. It is
 * OrgPlanConfig: the schema defaults maxCampaigns to 10 and maxCreators to 100,
 * so *any* org that has ever had a plan configured carries a small number in
 * those columns whether a person chose it or not. Production's demo org holds
 * 50/500 exactly that way. Reading them back would silently reinstate a cap the
 * plan tiers no longer describe -- and it would look like a plan decision
 * rather than a schema default nobody set.
 *
 * Seats stay real, because a seat is a person who can invite more people, and
 * the invite endpoint does enforce it.
 */
jest.mock("@/lib/db", () => ({
  db: { organization: { findUnique: jest.fn() } },
}));

import { db } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";

const mockDb = db as unknown as { organization: { findUnique: jest.Mock } };

const org = (over: Record<string, unknown> = {}) => ({
  id: "org-1",
  name: "Test Org",
  plan: "starter",
  planConfig: null,
  brandName: null,
  logoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
  fontFamily: null,
  uiConfig: null,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

it("reports campaigns and creators as uncapped for a fresh signup", async () => {
  mockDb.organization.findUnique.mockResolvedValue(org());

  const ent = await getOrgEntitlements("org-1");

  expect(ent?.limits.maxCampaigns).toBe(Infinity);
  expect(ent?.limits.maxCreators).toBe(Infinity);
});

it("ignores a stored planConfig cap on campaigns and creators", async () => {
  // The demo org's actual shape on production.
  mockDb.organization.findUnique.mockResolvedValue(
    org({ plan: "pro", planConfig: { planName: "pro", maxCampaigns: 50, maxCreators: 500, maxUsers: 10, maxTrackers: null, features: {} } }),
  );

  const ent = await getOrgEntitlements("org-1");

  expect(ent?.limits.maxCampaigns).toBe(Infinity);
  expect(ent?.limits.maxCreators).toBe(Infinity);
});

it("ignores the schema's own 10/100 defaults", async () => {
  /* The exact numbers a planConfig row gets when nobody sets them. These were
     mistaken for a deliberate starter limit once already. */
  mockDb.organization.findUnique.mockResolvedValue(
    org({ planConfig: { planName: "starter", maxCampaigns: 10, maxCreators: 100, maxUsers: 5, maxTrackers: null, features: {} } }),
  );

  const ent = await getOrgEntitlements("org-1");

  expect(ent?.limits.maxCampaigns).toBe(Infinity);
  expect(ent?.limits.maxCreators).toBe(Infinity);
});

it("still honours a planConfig override for seats and trackers", async () => {
  mockDb.organization.findUnique.mockResolvedValue(
    org({ planConfig: { planName: "starter", maxCampaigns: 10, maxCreators: 100, maxUsers: 12, maxTrackers: 40, features: {} } }),
  );

  const ent = await getOrgEntitlements("org-1");

  expect(ent?.limits.maxUsers).toBe(12);
  expect(ent?.limits.maxTrackers).toBe(40);
});

it("falls back to the plan tier for trackers when no override is set", async () => {
  mockDb.organization.findUnique.mockResolvedValue(org({ plan: "starter" }));

  const ent = await getOrgEntitlements("org-1");

  expect(ent?.limits.maxTrackers).toBe(25);
  expect(ent?.limits.maxUsers).toBe(5);
});

it("serialises an uncapped limit to null, which the UI reads as no counter", async () => {
  /* Infinity does not survive JSON. The tracker route already relies on this
     convention -- an unlimited plan sends null so the UI shows no counter
     rather than "3/null" -- and /api/tenant/config returns these fields
     straight, so the same has to hold here. */
  mockDb.organization.findUnique.mockResolvedValue(org());

  const ent = await getOrgEntitlements("org-1");
  const round = JSON.parse(JSON.stringify({ maxCampaigns: ent?.limits.maxCampaigns }));

  expect(round.maxCampaigns).toBeNull();
});

it("ignores the row shape signup actually creates", async () => {
  /* Signup does `orgPlanConfig.create({ data: { orgId, planName: "starter" } })`
     and lets the schema fill the rest, so a brand-new tenant has 10/100/5 in
     those columns and PLANS.starter's 20/500 never applied to it. That is what
     made a fresh signup report 10 campaigns and 100 creators, and it is the
     exact case this guard has to cover. maxTrackers is nullable, so it does
     still fall through to the tier. */
  mockDb.organization.findUnique.mockResolvedValue(
    org({
      plan: "starter",
      planConfig: { planName: "starter", maxCampaigns: 10, maxCreators: 100, maxUsers: 5, maxTrackers: null, features: {} },
    }),
  );

  const ent = await getOrgEntitlements("org-1");

  expect(ent?.limits.maxCampaigns).toBe(Infinity);
  expect(ent?.limits.maxCreators).toBe(Infinity);
  expect(ent?.limits.maxUsers).toBe(5);
  expect(ent?.limits.maxTrackers).toBe(25);
});
