import {
  NOTIFIABLE_ACTIONS,
  NOTIFICATION_FEED_LIMIT,
  NOTIFICATION_LOOKBACK_DAYS,
  describeNotification,
  formatUnreadBadge,
  notificationHref,
} from "@/lib/notificationFeed";
import { NOTIFICATION_EVENTS } from "@/lib/notificationCatalog";

describe("notification feed", () => {
  it("narrows the audit stream to exactly the notification catalog", () => {
    expect(NOTIFIABLE_ACTIONS).toHaveLength(NOTIFICATION_EVENTS.length);
    expect(NOTIFIABLE_ACTIONS).toContain("campaign.create");
    expect(NOTIFIABLE_ACTIONS).toContain("negotiation.approve");
    // Audit, not news.
    expect(NOTIFIABLE_ACTIONS).not.toContain("api_key.create");
    expect(NOTIFIABLE_ACTIONS).not.toContain("email.verified");
  });

  it("bounds the window and the dropdown", () => {
    expect(NOTIFICATION_LOOKBACK_DAYS).toBeGreaterThan(0);
    expect(NOTIFICATION_FEED_LIMIT).toBeGreaterThan(0);
    expect(NOTIFICATION_FEED_LIMIT).toBeLessThanOrEqual(20);
  });

  describe("notificationHref", () => {
    it("links entity types whose route is reachable from the audit row's id", () => {
      expect(notificationHref({ entityType: "campaign", entityId: "c1" })).toBe("/campaigns/c1");
      expect(notificationHref({ entityType: "creator", entityId: "cr1" })).toBe("/creators/cr1");
      expect(notificationHref({ entityType: "client", entityId: "cl1" })).toBe("/clients/cl1");
      expect(notificationHref({ entityType: "creator_list", entityId: "l1" })).toBe("/lists/l1");
      expect(notificationHref({ entityType: "song", entityId: "s1" })).toBe("/songs/s1");
    });

    it("falls back to the index for entity types with no detail route", () => {
      expect(notificationHref({ entityType: "activation", entityId: "a1" })).toBe("/activations");
      expect(notificationHref({ entityType: "payout", entityId: "p1" })).toBe("/payouts");
    });

    it("does not guess a route for a nested entity", () => {
      // A post lives at /campaigns/[id]/posts/[postId]; the row has no campaign id.
      expect(notificationHref({ entityType: "post", entityId: "p1" })).toBeNull();
      expect(notificationHref({ entityType: "Post", entityId: "p1" })).toBeNull();
      expect(notificationHref({ entityType: "NegotiationOffer", entityId: "n1" })).toBeNull();
      expect(notificationHref({ entityType: "CampaignDeposit", entityId: "d1" })).toBeNull();
      expect(notificationHref({ entityType: "PayoutRequest", entityId: "r1" })).toBeNull();
    });

    it("does not build a detail link without an id", () => {
      expect(notificationHref({ entityType: "campaign", entityId: null })).toBeNull();
    });
  });

  describe("describeNotification", () => {
    it("uses the catalog label and the entity's name", () => {
      expect(
        describeNotification({
          action: "campaign.create",
          entityType: "campaign",
          entityId: "c1",
          entityLabel: "Summer Drop",
        })
      ).toEqual({ glyph: "🎉", title: "Campaign Created — Summer Drop", href: "/campaigns/c1" });
    });

    it("omits the dash when the row carries no label", () => {
      const { title } = describeNotification({
        action: "payout.create",
        entityType: "payout",
        entityId: "p1",
        entityLabel: "   ",
      });
      expect(title).toBe("New Payout");
    });

    it("falls back to the raw action for a row outside the catalog", () => {
      const { glyph, title, href } = describeNotification({
        action: "widget.frobnicate",
        entityType: "widget",
        entityId: "w1",
        entityLabel: null,
      });
      expect(glyph).toBe("•");
      expect(title).toBe("widget.frobnicate");
      expect(href).toBeNull();
    });
  });

  describe("formatUnreadBadge", () => {
    it("hides at zero and caps at 9+", () => {
      expect(formatUnreadBadge(0)).toBe("");
      expect(formatUnreadBadge(-3)).toBe("");
      expect(formatUnreadBadge(1)).toBe("1");
      expect(formatUnreadBadge(9)).toBe("9");
      expect(formatUnreadBadge(10)).toBe("9+");
      expect(formatUnreadBadge(4210)).toBe("9+");
    });
  });
});
