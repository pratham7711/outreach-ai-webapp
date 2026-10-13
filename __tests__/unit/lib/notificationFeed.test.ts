import {
  collapseNotifications,
  isUnread,
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
      expect(notificationHref({ entityType: "creator_list", entityId: "l1" })).toBe("/lists/l1");
      expect(notificationHref({ entityType: "song", entityId: "s1" })).toBe("/songs/s1");
    });

    it("leaves parked pages unlinked rather than sending the bell to a redirect", () => {
      expect(notificationHref({ entityType: "activation", entityId: "a1" })).toBeNull();
      expect(notificationHref({ entityType: "payout", entityId: "p1" })).toBeNull();
      expect(notificationHref({ entityType: "client", entityId: "cl1" })).toBeNull();
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

describe("collapseNotifications", () => {
  const row = (id: string, action: string, entityId: string | null, label: string | null, createdAt: string) => ({
    id,
    action,
    entityType: "campaign",
    entityId,
    entityLabel: label,
    createdAt,
  });

  it("folds a run of the same event on the same entity into one line", () => {
    const groups = collapseNotifications([
      row("1", "campaign.create", "c2", "WALK", "2026-10-13T13:23:05Z"),
      row("2", "campaign.update", "c1", "LEAK IT (BTS)", "2026-10-10T01:25:10Z"),
      row("3", "campaign.update", "c1", "LEAK IT (BTS)", "2026-10-10T01:24:55Z"),
      row("4", "campaign.update", "c1", "LEAK IT (BTS)", "2026-10-10T01:24:51Z"),
      row("5", "campaign.create", "c3", "E2E", "2026-10-10T01:24:11Z"),
      row("6", "campaign.update", "c1", "LEAK IT (BTS)", "2026-10-10T01:08:54Z"),
    ]);
    expect(groups.map((g) => [g.item.id, g.items.length])).toEqual([
      ["1", 1],
      ["2", 3],
      ["5", 1],
      // The same update after something else is a separate moment.
      ["6", 1],
    ]);
  });

  it("keeps different entities apart even under the same action", () => {
    const groups = collapseNotifications([
      row("1", "campaign.update", "c1", "A", "2026-10-10T01:00:00Z"),
      row("2", "campaign.update", "c2", "B", "2026-10-10T00:59:00Z"),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("isUnread", () => {
  it("counts everything unread on a device that never marked the bell read", () => {
    expect(isUnread({ createdAt: "2020-01-01T00:00:00Z" }, null)).toBe(true);
  });

  it("is unread only when newer than the last Mark all as read", () => {
    const seen = "2026-10-10T00:00:00.000Z";
    expect(isUnread({ createdAt: "2026-10-10T00:00:01Z" }, seen)).toBe(true);
    expect(isUnread({ createdAt: "2026-10-09T23:59:59Z" }, seen)).toBe(false);
  });
});
