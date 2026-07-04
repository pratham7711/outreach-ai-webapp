import { decideSyncAction, SyncDecisionInput } from "@/lib/sync/cadence";

const NOW = new Date("2026-06-30T12:00:00.000Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function input(overrides: Partial<SyncDecisionInput> = {}): SyncDecisionInput {
  return {
    postedAt: hoursAgo(1),
    lastSyncedAt: null,
    syncFailCount: 0,
    syncDisabledAt: null,
    hasFinalSnapshot: false,
    trackingEnabled: false,
    trackingStartedAt: null,
    now: NOW,
    ...overrides,
  };
}

describe("decideSyncAction", () => {
  describe("dead-letter", () => {
    it("skips when syncDisabledAt is set", () => {
      expect(decideSyncAction(input({ syncDisabledAt: hoursAgo(2) }))).toEqual({
        action: "skip",
        reason: "dead-letter",
      });
    });

    it("takes precedence over sealed and age rules", () => {
      expect(
        decideSyncAction(
          input({
            syncDisabledAt: hoursAgo(2),
            hasFinalSnapshot: true,
            postedAt: hoursAgo(60 * 24),
          })
        )
      ).toEqual({ action: "skip", reason: "dead-letter" });
    });
  });

  describe("sealed", () => {
    it("skips when a final snapshot exists", () => {
      expect(decideSyncAction(input({ hasFinalSnapshot: true }))).toEqual({
        action: "skip",
        reason: "sealed",
      });
    });

    it("skips a >30d post that already has a final snapshot", () => {
      expect(
        decideSyncAction(input({ postedAt: hoursAgo(45 * 24), hasFinalSnapshot: true }))
      ).toEqual({ action: "skip", reason: "sealed" });
    });
  });

  describe("seal at 30d", () => {
    it("seals a >30d post without a final snapshot", () => {
      const decision = decideSyncAction(input({ postedAt: hoursAgo(31 * 24) }));
      expect(decision.action).toBe("seal");
    });

    it("seals just past the 30d boundary", () => {
      const decision = decideSyncAction(input({ postedAt: hoursAgo(30 * 24 + 0.01) }));
      expect(decision.action).toBe("seal");
    });

    it("does not seal at exactly 30d", () => {
      const decision = decideSyncAction(
        input({ postedAt: hoursAgo(30 * 24), lastSyncedAt: hoursAgo(48) })
      );
      expect(decision.action).toBe("sync");
    });

    it("seals even if the last sync was recent", () => {
      const decision = decideSyncAction(
        input({ postedAt: hoursAgo(35 * 24), lastSyncedAt: hoursAgo(1) })
      );
      expect(decision.action).toBe("seal");
    });
  });

  describe("tracking window (72h)", () => {
    it("syncs hourly when tracking is on and last sync is 1h or older", () => {
      expect(
        decideSyncAction(
          input({
            postedAt: hoursAgo(2 * 24),
            lastSyncedAt: hoursAgo(1),
            trackingEnabled: true,
            trackingStartedAt: hoursAgo(2),
          })
        )
      ).toEqual({ action: "sync", reason: "tracking-hourly" });
    });

    it("syncs a fresh tracked post that was never synced", () => {
      expect(
        decideSyncAction(
          input({
            postedAt: hoursAgo(2 * 24),
            lastSyncedAt: null,
            trackingEnabled: true,
            trackingStartedAt: hoursAgo(1),
          })
        )
      ).toEqual({ action: "sync", reason: "tracking-hourly" });
    });

    it("throttles a tracked post synced under 1h ago (does not fall through to normal cadence)", () => {
      expect(
        decideSyncAction(
          input({
            postedAt: hoursAgo(2 * 24),
            lastSyncedAt: hoursAgo(0.5),
            trackingEnabled: true,
            trackingStartedAt: hoursAgo(2),
          })
        )
      ).toEqual({ action: "skip", reason: "tracking-throttle" });
    });

    it("stops boosting after 72h — falls through to normal age cadence", () => {
      expect(
        decideSyncAction(
          input({
            postedAt: hoursAgo(5 * 24),
            lastSyncedAt: hoursAgo(2),
            trackingEnabled: true,
            trackingStartedAt: hoursAgo(73),
          })
        )
      ).toEqual({ action: "skip", reason: "cadence-1-7d" });
    });

    it("does not boost at exactly 72h into tracking", () => {
      expect(
        decideSyncAction(
          input({
            postedAt: hoursAgo(5 * 24),
            lastSyncedAt: hoursAgo(2),
            trackingEnabled: true,
            trackingStartedAt: hoursAgo(72),
          })
        )
      ).toEqual({ action: "skip", reason: "cadence-1-7d" });
    });

    it("ignores tracking flag when trackingStartedAt is null", () => {
      expect(
        decideSyncAction(
          input({
            postedAt: hoursAgo(3 * 24),
            lastSyncedAt: hoursAgo(0.5),
            trackingEnabled: true,
            trackingStartedAt: null,
          })
        )
      ).toEqual({ action: "skip", reason: "cadence-1-7d" });
    });

    it("dead-letter still wins over tracking", () => {
      expect(
        decideSyncAction(
          input({
            syncDisabledAt: hoursAgo(1),
            trackingEnabled: true,
            trackingStartedAt: hoursAgo(1),
            lastSyncedAt: hoursAgo(2),
          })
        )
      ).toEqual({ action: "skip", reason: "dead-letter" });
    });

    it("sealed still wins over tracking", () => {
      expect(
        decideSyncAction(
          input({
            hasFinalSnapshot: true,
            trackingEnabled: true,
            trackingStartedAt: hoursAgo(1),
            lastSyncedAt: hoursAgo(2),
          })
        )
      ).toEqual({ action: "skip", reason: "sealed" });
    });

    it("30d seal still wins over tracking", () => {
      expect(
        decideSyncAction(
          input({
            postedAt: hoursAgo(31 * 24),
            trackingEnabled: true,
            trackingStartedAt: hoursAgo(1),
            lastSyncedAt: hoursAgo(2),
          })
        ).action
      ).toBe("seal");
    });
  });

  describe("7-30d cadence", () => {
    it("skips when last sync is under 24h old", () => {
      expect(
        decideSyncAction(input({ postedAt: hoursAgo(10 * 24), lastSyncedAt: hoursAgo(23) }))
      ).toEqual({ action: "skip", reason: "cadence-7-30d" });
    });

    it("skips when last sync is just under 24h old", () => {
      expect(
        decideSyncAction(input({ postedAt: hoursAgo(29 * 24), lastSyncedAt: hoursAgo(23.99) }))
      ).toEqual({ action: "skip", reason: "cadence-7-30d" });
    });

    it("syncs when last sync is 24h or older", () => {
      const decision = decideSyncAction(
        input({ postedAt: hoursAgo(10 * 24), lastSyncedAt: hoursAgo(24) })
      );
      expect(decision.action).toBe("sync");
    });

    it("syncs when never synced", () => {
      const decision = decideSyncAction(
        input({ postedAt: hoursAgo(10 * 24), lastSyncedAt: null })
      );
      expect(decision.action).toBe("sync");
    });
  });

  describe("1-7d cadence", () => {
    it("skips when last sync is under 6h old", () => {
      expect(
        decideSyncAction(input({ postedAt: hoursAgo(3 * 24), lastSyncedAt: hoursAgo(5) }))
      ).toEqual({ action: "skip", reason: "cadence-1-7d" });
    });

    it("skips at just past 1d age with a fresh sync", () => {
      expect(
        decideSyncAction(input({ postedAt: hoursAgo(25), lastSyncedAt: hoursAgo(5.99) }))
      ).toEqual({ action: "skip", reason: "cadence-1-7d" });
    });

    it("syncs when last sync is 6h or older", () => {
      const decision = decideSyncAction(
        input({ postedAt: hoursAgo(3 * 24), lastSyncedAt: hoursAgo(6) })
      );
      expect(decision.action).toBe("sync");
    });

    it("syncs when never synced", () => {
      const decision = decideSyncAction(
        input({ postedAt: hoursAgo(3 * 24), lastSyncedAt: null })
      );
      expect(decision.action).toBe("sync");
    });

    it("applies 1-7d cadence at exactly 7d age", () => {
      expect(
        decideSyncAction(input({ postedAt: hoursAgo(7 * 24), lastSyncedAt: hoursAgo(5) }))
      ).toEqual({ action: "skip", reason: "cadence-1-7d" });
      expect(
        decideSyncAction(
          input({ postedAt: hoursAgo(7 * 24), lastSyncedAt: hoursAgo(6) })
        ).action
      ).toBe("sync");
    });
  });

  describe("fresh posts", () => {
    it("syncs a fresh post never synced", () => {
      expect(decideSyncAction(input({ postedAt: hoursAgo(1) })).action).toBe("sync");
    });

    it("syncs a fresh post even with a very recent sync", () => {
      expect(
        decideSyncAction(input({ postedAt: hoursAgo(12), lastSyncedAt: hoursAgo(0.5) })).action
      ).toBe("sync");
    });

    it("syncs at exactly 24h age regardless of last sync", () => {
      expect(
        decideSyncAction(input({ postedAt: hoursAgo(24), lastSyncedAt: hoursAgo(1) })).action
      ).toBe("sync");
    });

    it("ignores syncFailCount below the dead-letter threshold", () => {
      expect(
        decideSyncAction(input({ postedAt: hoursAgo(1), syncFailCount: 4 })).action
      ).toBe("sync");
    });
  });
});
