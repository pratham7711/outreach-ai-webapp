import {
  decideSyncSlotTransition,
  velocityPerHour,
  pickRerollTarget,
  pinCap,
  canPin,
  HARD_CEILING_HOURS,
} from "@/lib/syncSlot/state";

const NOW = new Date("2026-06-30T12:00:00.000Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

describe("velocityPerHour", () => {
  it("returns null with fewer than two snapshots", () => {
    expect(velocityPerHour([])).toBeNull();
    expect(velocityPerHour([{ viewsCount: 10, recordedAt: hoursAgo(1) }])).toBeNull();
  });

  it("computes views per hour from the two most recent snapshots", () => {
    expect(
      velocityPerHour([
        { viewsCount: 100, recordedAt: hoursAgo(2) },
        { viewsCount: 300, recordedAt: hoursAgo(1) },
      ])
    ).toBe(200);
  });

  it("orders snapshots before measuring, so input order does not change the answer", () => {
    expect(
      velocityPerHour([
        { viewsCount: 300, recordedAt: hoursAgo(1) },
        { viewsCount: 100, recordedAt: hoursAgo(2) },
      ])
    ).toBe(200);
  });

  it("returns null when two snapshots share a timestamp rather than dividing by zero", () => {
    expect(
      velocityPerHour([
        { viewsCount: 100, recordedAt: hoursAgo(1) },
        { viewsCount: 300, recordedAt: hoursAgo(1) },
      ])
    ).toBeNull();
  });
});

describe("decideSyncSlotTransition", () => {
  it("never releases a pinned tracker, even past the hard ceiling", () => {
    expect(
      decideSyncSlotTransition({
        state: "PINNED",
        assignedAt: hoursAgo(HARD_CEILING_HOURS + 100),
        now: NOW,
        velocityPerHour: 0,
      })
    ).toEqual({ next: "PINNED", reason: "pinned" });
  });

  it("holds a hot tracker inside the 6h window", () => {
    expect(
      decideSyncSlotTransition({
        state: "ASSIGNED",
        assignedAt: hoursAgo(3),
        now: NOW,
        velocityPerHour: 0,
      }).next
    ).toBe("ASSIGNED");
  });

  it("keeps a still-climbing post hot past the 6h window", () => {
    expect(
      decideSyncSlotTransition({
        state: "ASSIGNED",
        assignedAt: hoursAgo(10),
        now: NOW,
        velocityPerHour: 5000,
      })
    ).toEqual({ next: "ASSIGNED", reason: "hot" });
  });

  it("advances a quiet post to warm once the 6h window elapses", () => {
    expect(
      decideSyncSlotTransition({
        state: "ASSIGNED",
        assignedAt: hoursAgo(10),
        now: NOW,
        velocityPerHour: 1,
      })
    ).toEqual({ next: "WARM", reason: "hot-window-elapsed" });
  });

  it("keeps a viral post warm past 72h instead of releasing the tracker mid-run", () => {
    expect(
      decideSyncSlotTransition({
        state: "WARM",
        assignedAt: hoursAgo(90),
        now: NOW,
        velocityPerHour: 9000,
      })
    ).toEqual({ next: "WARM", reason: "warm" });
  });

  it("cools a quiet post after the 72h window", () => {
    expect(
      decideSyncSlotTransition({
        state: "WARM",
        assignedAt: hoursAgo(90),
        now: NOW,
        velocityPerHour: 2,
      })
    ).toEqual({ next: "COOLING", reason: "warm-window-elapsed" });
  });

  it("releases a cooling tracker once velocity falls below the threshold", () => {
    expect(
      decideSyncSlotTransition({
        state: "COOLING",
        assignedAt: hoursAgo(100),
        now: NOW,
        velocityPerHour: 1,
      })
    ).toEqual({ next: "RELEASED", reason: "velocity-below-threshold" });
  });

  it("holds a cooling tracker that is still earning", () => {
    expect(
      decideSyncSlotTransition({
        state: "COOLING",
        assignedAt: hoursAgo(100),
        now: NOW,
        velocityPerHour: 500,
      })
    ).toEqual({ next: "COOLING", reason: "still-earning" });
  });

  it("forces release at the hard ceiling however fast the post is still moving", () => {
    expect(
      decideSyncSlotTransition({
        state: "COOLING",
        assignedAt: hoursAgo(HARD_CEILING_HOURS + 1),
        now: NOW,
        velocityPerHour: 100000,
      })
    ).toEqual({ next: "RELEASED", reason: "hard-ceiling" });
  });

  it("advances when velocity is unknown rather than holding a slot forever", () => {
    expect(
      decideSyncSlotTransition({
        state: "WARM",
        assignedAt: hoursAgo(90),
        now: NOW,
        velocityPerHour: null,
      }).next
    ).toBe("COOLING");
  });

  it("leaves pool and released trackers alone", () => {
    expect(
      decideSyncSlotTransition({ state: "POOL", assignedAt: null, now: NOW, velocityPerHour: null }).next
    ).toBe("POOL");
    expect(
      decideSyncSlotTransition({ state: "RELEASED", assignedAt: null, now: NOW, velocityPerHour: null }).next
    ).toBe("RELEASED");
  });
});

describe("reroll and pinning", () => {
  it("picks the highest predicted value rather than the first candidate", () => {
    expect(
      pickRerollTarget([
        { postId: "a", predictedValue: 10 },
        { postId: "b", predictedValue: 90 },
        { postId: "c", predictedValue: 50 },
      ])
    ).toEqual({ postId: "b", predictedValue: 90 });
  });

  it("returns null when nothing is waiting", () => {
    expect(pickRerollTarget([])).toBeNull();
  });

  it("caps pins at 20% of the pool so reroll cannot starve", () => {
    expect(pinCap(100)).toBe(20);
    expect(canPin(100, 19)).toBe(true);
    expect(canPin(100, 20)).toBe(false);
  });

  it("allows at least one pin on a tiny pool", () => {
    expect(pinCap(3)).toBe(1);
    expect(pinCap(0)).toBe(0);
  });
});
