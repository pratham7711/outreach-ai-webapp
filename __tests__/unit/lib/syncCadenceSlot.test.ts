import { decideSyncAction, SyncDecisionInput } from "@/lib/sync/cadence";

const NOW = new Date("2026-06-30T12:00:00.000Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function hoursAhead(hours: number): Date {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000);
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

/* These all sit past SEAL_AGE_HOURS deliberately. The settlement escape lives
   inside the seal branch, so it only has anything to override once a post is
   old enough to be sealed. Below that horizon a post is already synced daily by
   the ordinary cadence, which is what settlement wanted in the first place. */
describe("settlement poll is never metered by the tracker", () => {
  it("does not seal a >180d post while its payout window is still open", () => {
    const decision = decideSyncAction(
      input({
        postedAt: hoursAgo(200 * 24),
        lastSyncedAt: hoursAgo(30),
        settlementClosesAt: hoursAhead(24 * 10),
      })
    );
    expect(decision).toEqual({ action: "sync", reason: "settlement-daily" });
  });

  it("keeps settling daily even with no tracker attached at all", () => {
    const decision = decideSyncAction(
      input({
        postedAt: hoursAgo(220 * 24),
        lastSyncedAt: hoursAgo(25),
        slot: null,
        settlementClosesAt: hoursAhead(48),
      })
    );
    expect(decision.action).toBe("sync");
  });

  it("keeps settling after the tracker has been released", () => {
    const decision = decideSyncAction(
      input({
        postedAt: hoursAgo(190 * 24),
        lastSyncedAt: hoursAgo(26),
        slot: { state: "RELEASED", hotUntil: null },
        settlementClosesAt: hoursAhead(72),
      })
    );
    expect(decision).toEqual({ action: "sync", reason: "settlement-daily" });
  });

  it("throttles settlement to daily rather than polling it hourly", () => {
    const decision = decideSyncAction(
      input({
        postedAt: hoursAgo(200 * 24),
        lastSyncedAt: hoursAgo(2),
        settlementClosesAt: hoursAhead(24),
      })
    );
    expect(decision).toEqual({ action: "skip", reason: "settlement-throttle" });
  });

  it("seals once the payout window has closed", () => {
    const decision = decideSyncAction(
      input({
        postedAt: hoursAgo(200 * 24),
        lastSyncedAt: hoursAgo(30),
        settlementClosesAt: hoursAgo(1),
      })
    );
    expect(decision).toEqual({ action: "seal", reason: "age-over-180d" });
  });

  it("still seals at 180d when no settlement window is supplied", () => {
    const decision = decideSyncAction(input({ postedAt: hoursAgo(181 * 24) }));
    expect(decision).toEqual({ action: "seal", reason: "age-over-180d" });
  });
});

describe("tracker tiers", () => {
  it("polls a hot tracker every five minutes", () => {
    expect(
      decideSyncAction(
        input({
          postedAt: hoursAgo(2),
          lastSyncedAt: hoursAgo(0.2),
          slot: { state: "ASSIGNED", hotUntil: hoursAhead(4) },
        })
      )
    ).toEqual({ action: "sync", reason: "slot-hot" });
  });

  it("throttles a hot tracker synced under five minutes ago", () => {
    expect(
      decideSyncAction(
        input({
          postedAt: hoursAgo(2),
          lastSyncedAt: hoursAgo(0.05),
          slot: { state: "ASSIGNED", hotUntil: hoursAhead(4) },
        })
      )
    ).toEqual({ action: "skip", reason: "slot-throttle-hot" });
  });

  it("drops an assigned tracker to hourly once its hot window expires", () => {
    expect(
      decideSyncAction(
        input({
          postedAt: hoursAgo(20),
          lastSyncedAt: hoursAgo(0.5),
          slot: { state: "ASSIGNED", hotUntil: hoursAgo(2) },
        })
      )
    ).toEqual({ action: "skip", reason: "slot-throttle-warm" });
  });

  it("polls a warm tracker hourly", () => {
    expect(
      decideSyncAction(
        input({
          postedAt: hoursAgo(30),
          lastSyncedAt: hoursAgo(1.5),
          slot: { state: "WARM", hotUntil: null },
        })
      )
    ).toEqual({ action: "sync", reason: "slot-warm" });
  });

  it("decays a cooling tracker to six-hourly", () => {
    expect(
      decideSyncAction(
        input({
          postedAt: hoursAgo(100),
          lastSyncedAt: hoursAgo(3),
          slot: { state: "COOLING", hotUntil: null },
        })
      )
    ).toEqual({ action: "skip", reason: "slot-throttle-cooling" });
  });

  it("keeps a pinned tracker on a high-resolution tier", () => {
    expect(
      decideSyncAction(
        input({
          postedAt: hoursAgo(200),
          lastSyncedAt: hoursAgo(2),
          slot: { state: "PINNED", hotUntil: null },
        })
      )
    ).toEqual({ action: "sync", reason: "slot-hot" });
  });

  it("falls through to legacy cadence when the tracker is back in the pool", () => {
    expect(
      decideSyncAction(
        input({
          postedAt: hoursAgo(3 * 24),
          lastSyncedAt: hoursAgo(5),
          slot: { state: "POOL", hotUntil: null },
        })
      )
    ).toEqual({ action: "skip", reason: "cadence-1-7d" });
  });

  it("lets dead-letter beat any tracker tier", () => {
    expect(
      decideSyncAction(
        input({
          syncDisabledAt: hoursAgo(1),
          slot: { state: "ASSIGNED", hotUntil: hoursAhead(4) },
        })
      )
    ).toEqual({ action: "skip", reason: "dead-letter" });
  });

  it("lets a sealed post beat any tracker tier", () => {
    expect(
      decideSyncAction(
        input({
          hasFinalSnapshot: true,
          slot: { state: "ASSIGNED", hotUntil: hoursAhead(4) },
        })
      )
    ).toEqual({ action: "skip", reason: "sealed" });
  });
});
