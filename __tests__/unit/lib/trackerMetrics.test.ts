import {
  changeOverWindow,
  deltaFrom,
  latestOf,
  previousOf,
  statusFor,
  velocityPerHour,
  isTrackerWindow,
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
