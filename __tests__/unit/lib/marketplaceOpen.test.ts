/**
 * @jest-environment node
 *
 * /explore must call a campaign closed exactly when the portal does, or its
 * "Join campaign" button leads a creator into a campaign that then refuses them.
 */
jest.mock("@/lib/db", () => ({ db: {} }));

import { isMarketplaceCampaignOpen, toCardDTO, type MarketplaceListRow } from "@/lib/marketplace/public";
import { isPortalCampaignActionable } from "@/lib/marketplace/portalVisibility";

const NOW = new Date("2026-10-13T12:00:00Z").getTime();

describe("isMarketplaceCampaignOpen", () => {
  it.each(["DRAFT", "PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"])(
    "agrees with the portal about status %s",
    (status) => {
      expect(isMarketplaceCampaignOpen(status, null, NOW)).toBe(isPortalCampaignActionable(status));
    },
  );

  it("is closed once the submission deadline has passed", () => {
    expect(isMarketplaceCampaignOpen("IN_PROGRESS", new Date("2026-10-02T00:00:00Z"), NOW)).toBe(false);
  });

  it("is open up to and including the deadline instant", () => {
    expect(isMarketplaceCampaignOpen("IN_PROGRESS", new Date(NOW), NOW)).toBe(true);
    expect(isMarketplaceCampaignOpen("IN_PROGRESS", "2026-10-30T00:00:00Z", NOW)).toBe(true);
  });

  it("is open with no deadline at all", () => {
    expect(isMarketplaceCampaignOpen("IN_PROGRESS", null, NOW)).toBe(true);
  });
});

describe("toCardDTO", () => {
  const row = (over: Partial<MarketplaceListRow> = {}): MarketplaceListRow => ({
    id: "c1",
    publicSlug: "summer-drop",
    title: "Summer Drop",
    campaignType: "VIEW_BASED",
    ratePerThousand: null,
    currency: "USD",
    marketplaceBudgetCapMinor: null,
    submissionDeadline: null,
    createdAt: new Date(),
    status: "IN_PROGRESS",
    org: { name: "Demo Agency", brandName: null, logoUrl: null },
    _count: { activations: 0 },
    ...over,
  });

  it("marks a running campaign open and a finished one closed", () => {
    expect(toCardDTO(row()).open).toBe(true);
    expect(toCardDTO(row({ status: "COMPLETE" })).open).toBe(false);
    expect(toCardDTO(row({ submissionDeadline: new Date("2020-01-01T00:00:00Z") })).open).toBe(false);
  });

  it("never sends the raw status", () => {
    expect(toCardDTO(row())).not.toHaveProperty("status");
  });
});
