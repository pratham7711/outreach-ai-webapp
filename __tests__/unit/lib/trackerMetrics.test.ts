import {
  changeOverWindow,
  deltaFrom,
  latestOf,
  previousOf,
  statusFor,
  velocityPerHour,
  isTrackerWindow,
  readHealthFor,
  isMeasurable,
  formatSpanHours,
  spanMatchesWindow,
  changeSpanLabel,
} from "@/lib/trackers/metrics";

const NOW = new Date("2026-08-14T12:00:00.000Z");

function hoursAgo(hours: number) {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function snap(value: number, hours: number) {
  return { value, recordedAt: hoursAgo(hours) };
}

describe("deltaFrom and velocityPerHour", () => {
  it("returns null when either side is missing, rather than pretending it is zero", () => {
    expect(deltaFrom(null, snap(10, 0))).toBeNull();
    expect(deltaFrom(snap(10, 1), null)).toBeNull();
    expect(velocityPerHour(null, snap(10, 0))).toBeNull();
  });

  it("computes a plain delta", () => {
    expect(deltaFrom(snap(100, 2), snap(180, 1))).toBe(80);
  });

  it("computes views per hour across the gap", () => {
    expect(velocityPerHour(snap(100, 3), snap(400, 1))).toBe(150);
  });

  it("returns null rather than dividing by zero on identical timestamps", () => {
    expect(velocityPerHour(snap(100, 1), snap(400, 1))).toBeNull();
  });

  it("reports a negative velocity when a count falls", () => {
    expect(velocityPerHour(snap(500, 2), snap(300, 1))).toBe(-200);
  });
});

describe("changeOverWindow", () => {
  const series = [snap(1000, 72), snap(1200, 48), snap(1500, 24), snap(2000, 1)];

  it("returns null for an empty series", () => {
    expect(changeOverWindow([], "24h", NOW)).toBeNull();
  });

  it("returns null for a single snapshot instead of reporting 0%", () => {
    expect(changeOverWindow([snap(500, 1)], "24h", NOW)).toBeNull();
  });

  it("measures only inside the requested window", () => {
    const result = changeOverWindow(series, "24h", NOW);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(1500);
    expect(result!.to).toBe(2000);
    expect(result!.added).toBe(500);
  });

  it("widens the baseline as the window grows", () => {
    const result = changeOverWindow(series, "7d", NOW);
    expect(result!.from).toBe(1000);
    expect(result!.added).toBe(1000);
  });

  it("computes percent against the baseline", () => {
    const result = changeOverWindow(series, "7d", NOW);
    expect(result!.percent).toBeCloseTo(100, 5);
  });

  it("returns a null percent when the baseline is zero rather than dividing by it", () => {
    const result = changeOverWindow([snap(0, 24), snap(50, 1)], "24h", NOW);
    expect(result!.added).toBe(50);
    expect(result!.percent).toBeNull();
  });

  it("falls back to the previous snapshot when only one sits inside the window", () => {
    const result = changeOverWindow([snap(800, 100), snap(900, 2)], "24h", NOW);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(800);
    expect(result!.to).toBe(900);
  });

  it("does not order-depend on the input array", () => {
    const shuffled = [series[2], series[0], series[3], series[1]];
    expect(changeOverWindow(shuffled, "7d", NOW)).toEqual(changeOverWindow(series, "7d", NOW));
  });
});

describe("statusFor", () => {
  it("reports unknown when velocity is unknown, never stable", () => {
    expect(statusFor(null)).toBe("unknown");
  });

  it("grades a rising sound", () => {
    expect(statusFor(0)).toBe("stable");
    expect(statusFor(9.9)).toBe("stable");
    expect(statusFor(10)).toBe("trending");
    expect(statusFor(100)).toBe("viral");
  });

  it("reports a falling count as declining", () => {
    expect(statusFor(-1)).toBe("declining");
  });
});

describe("latestOf and previousOf", () => {
  it("finds the newest and second-newest regardless of input order", () => {
    const series = [snap(3, 1), snap(1, 10), snap(2, 5)];
    expect(latestOf(series)!.value).toBe(3);
    expect(previousOf(series)!.value).toBe(2);
  });

  it("has no previous with a single snapshot", () => {
    expect(previousOf([snap(1, 1)])).toBeNull();
    expect(latestOf([])).toBeNull();
  });
});

describe("isTrackerWindow", () => {
  it("accepts the four reference periods and rejects anything else", () => {
    expect(isTrackerWindow("24h")).toBe(true);
    expect(isTrackerWindow("30d")).toBe(true);
    expect(isTrackerWindow("90d")).toBe(false);
    expect(isTrackerWindow("")).toBe(false);
  });
});

describe("readHealthFor — a count and its age are one fact", () => {
  it("is pending when nothing has ever been read", () => {
    expect(readHealthFor(null, NOW)).toBe("pending");
  });

  it("is live inside the fresh window", () => {
    expect(readHealthFor(hoursAgo(1), NOW)).toBe("live");
    expect(readHealthFor(hoursAgo(23.9), NOW)).toBe("live");
  });

  it("treats a reading dated slightly in the future as live, not stale", () => {
    // Clock skew between the reader box and the app should not blank the page.
    const future = new Date(NOW.getTime() + 30 * 1000);
    expect(readHealthFor(future, NOW)).toBe("live");
  });

  it("flips to regressed once the reader has missed six cycles", () => {
    expect(readHealthFor(hoursAgo(24.1), NOW)).toBe("regressed");
  });

  it("is regressed — not stale — for the real nine-day outage this fixes", () => {
    // "Wherever I Go": last read 22 Aug 22:00, still showing "stable +0.0%".
    expect(readHealthFor(hoursAgo(9 * 24), NOW)).toBe("regressed");
  });

  it("is stale once a row has gone a month unread", () => {
    expect(readHealthFor(hoursAgo(30 * 24 + 1), NOW)).toBe("stale");
  });

  it("only calls a live tracker measurable", () => {
    expect(isMeasurable("live")).toBe(true);
    for (const h of ["pending", "regressed", "stale"] as const) {
      expect(isMeasurable(h)).toBe(false);
    }
  });

  it("refuses to present a delta for the stale-fallback case", () => {
    // changeOverWindow still returns a change here: with no snapshot inside the
    // 24h window it falls back to the second-newest reading of all time. Both
    // are the same nine-day-old 45, sixty seconds apart, so it reports +0 at a
    // velocity of 0 — which statusFor calls "stable". The arithmetic is right;
    // showing it is not. Health is the gate that stops it reaching the user.
    const nineDays = 9 * 24;
    const snapshots = [snap(45, nineDays), snap(45, nineDays + 1 / 60)];
    const change = changeOverWindow(snapshots, "24h", NOW);
    expect(change).not.toBeNull();
    expect(change!.added).toBe(0);
    expect(statusFor(change!.velocityPerHour)).toBe("stable");

    // ...and this is why that must never be rendered.
    expect(isMeasurable(readHealthFor(hoursAgo(nineDays), NOW))).toBe(false);
  });
});

/**
 * A change is labelled with the span it actually covers.
 *
 * changeOverWindow falls back to the last two readings of all time when fewer
 * than two land inside the window, so the number it returns can span ten days
 * while the caller prints "24h". spanHours has always said so and nobody read
 * it.
 */
describe("span labelling", () => {
  it("names a span in the unit a reader can hold", () => {
    expect(formatSpanHours(0.5)).toBe("30m");
    expect(formatSpanHours(20)).toBe("20h");
    expect(formatSpanHours(240)).toBe("10d");
  });

  it("keeps the window's own label when the readings nearly fill it", () => {
    // Four-hourly readings put the oldest in-window baseline 20h back.
    expect(spanMatchesWindow(20, "24h")).toBe(true);
    expect(changeSpanLabel({ spanHours: 20 }, "24h", "24h")).toBe("24h");
  });

  it("prints the real span when it is not the window that was asked for", () => {
    // The reported case: a 60-row series is ten days at the four-hourly
    // cadence, so 14d and 30d both measured ten days and both said otherwise.
    expect(spanMatchesWindow(240, "30d")).toBe(false);
    expect(changeSpanLabel({ spanHours: 240 }, "30d", "30d")).toBe("10d");
    expect(changeSpanLabel({ spanHours: 240 }, "14d", "14d")).toBe("10d");
    // And the "+50,000 / 24h" case, which was a ten-day gain.
    expect(changeSpanLabel({ spanHours: 240 }, "24h", "24h")).toBe("10d");
  });

  it("leaves the label alone when there is no change to label", () => {
    expect(changeSpanLabel(null, "7d", "7d")).toBe("7d");
  });
});
